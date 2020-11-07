'use strict';
/**
 * Read the documentation (https://strapi.io/documentation/3.0.0-beta.x/concepts/controllers.html#core-controllers)
 * to customize this controller
 */
const yaml = require('js-yaml')
const findIndex = require('lodash/findIndex')
const omit = require('lodash/omit')
const crypto = require('crypto')
const axios = require('axios')
const axiosInstance = axios.create({
  timeout: 100000
})
axiosInstance.interceptors.response.use(function (response) {
  return response.data
}, function (error) {
  return Promise.reject(error)
})

function createNewUserKey(data) {
  let encrypted = ''
  const algorithm = 'aes-192-cbc'
  const password = '帅的一批'
  const key = crypto.scryptSync(password, data.created_at + '', 24)
  const iv = Buffer.alloc(16, 0)
  const cipher = crypto.createCipheriv(algorithm, key, iv)
  cipher.on('readable', () => {
    let chunk;
    while (null !== (chunk = cipher.read())) {
      encrypted += chunk.toString('hex');
    }
  })
  cipher.write(data)
  cipher.end()
  return new Promise((resolve) => {
    cipher.on('end', () => {
      resolve(encrypted)
    })
  })
}

function getNameByUrl(url, key = 'key') {
  if (!url) return null
  return new URL(url).searchParams.get(key)
}

function mixinProxyGroup(targetGroup, sourceGroup) {
  sourceGroup.forEach(item => {
    const commonIndex = findIndex(targetGroup, ['name', item.name])
    if (commonIndex < 0) {
      targetGroup.push(item)
    } else {
      const targetProxies = targetGroup[commonIndex].proxies
      targetProxies.push(...item.proxies)
    }
  })
}

function getRuleKey(rule) {
  return (rule.match(/[\w\-,\\./]+(?=,\w+)/g) || [])[0]
}

function changeRuleToMap(source) {
  const rules = new Map()
  source.forEach(item => {
    const key = getRuleKey(item)
    rules.set(key, item)
  })
  return rules
}

// 根据源数据生成profile文件
async function createProfile(list) {
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error('list 为空')
  }
  let file
  let newProfile = {
    proxies: [],
    'proxy-groups': [],
    rules: []
  }

  const profileList = await Promise.all(list.map(item => {
    if (item.type === 'link') {
      return axiosInstance.get(item.content).then(res => {
        return yaml.safeLoad(res)
      }).catch(e => {
        throw new Error(e)
      })
    }
    if (item.type === 'file') {
      return Promise.resolve(yaml.safeLoad(item.content))
    }
    return Promise.resolve('')
  }))

  const newProfileProxyGroup = newProfile['proxy-groups']
  Object.assign(newProfile, ...profileList.map(item => omit(item, ['Proxy', 'Proxy Group', 'Rule', 'proxies', 'proxy-groups', 'rules'])))
  const rules = changeRuleToMap(newProfile.rules)
  profileList.forEach((profile) => {
    const profileRules = profile.Rule || profile.rules || []
    newProfile.proxies = newProfile.proxies.concat(profile.Proxy || profile.proxies || [])
    mixinProxyGroup(newProfileProxyGroup, profile['Proxy Group'] || profile['proxy-groups'] || [])
    Array.isArray(profileRules) && profileRules.forEach(item => rules.set(getRuleKey(item), item))
  })

  // 对规则排序确保MATCH在最后
  newProfile.rules = [...rules.values()].sort((a, b) => {
    const ruleTypes = ['DOMAIN-SUFFIX', 'DOMAIN', 'DOMAIN-KEYWORD', 'IP-CIDR', 'SRC-IP-CIDR', 'GEOIP', 'DST-PORT', 'SRC-PORT', 'MATCH']
    const getRuleTypeIndex = (key) => ruleTypes.indexOf(key.slice(0, key.indexOf(',')))
    return getRuleTypeIndex(a) - getRuleTypeIndex(b)
  })
  file = yaml.safeDump(newProfile, {
    noRefs: true
  })
  return file
}

module.exports = {
  async create(ctx) {
    const {
      request
    } = ctx
    const {
      myProfileLink,
      profiles
    } = request.body
    const clashUserServer = strapi.services['clash-user']
    if (!Array.isArray(profiles)) return ctx.throw(500, '配置为空')
    let name = getNameByUrl(myProfileLink)
    let entry = {}
    let user = name ? await clashUserServer.findOne({
      name
    }) : null
    if (!user) {
      entry = await clashUserServer.create({
        profiles
      })
      name = entry.name = await createNewUserKey(entry.id + '')
      await clashUserServer.update({
        id: entry.id
      }, entry)
    } else {
      await clashUserServer.update({
        id: user.id
      }, Object.assign(entry, {
        profiles
      }))
    }
    return await clashUserServer.findOne({
      name
    })
  },
  async profile(ctx) {
    const {
      request
    } = ctx
    const clashUserServer = strapi.services['clash-user']
    const user = await clashUserServer.findOne({
      name: request.query.key
    })
    let fileContent = null
    if (user) {
      try {
        fileContent = await createProfile(user.profiles)
      } catch (e) {
        return ctx.throw(500, e)
      }
    }
    return fileContent
  }
};
