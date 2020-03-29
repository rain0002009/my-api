'use strict';

/**
 * Read the documentation (https://strapi.io/documentation/3.0.0-beta.x/concepts/services.html#core-services)
 * to customize this service
 */

module.exports = {
  findOne({
    name
  }) {
    return strapi.query('clash-user').findOne({
      name
    })
  },
  delete({
    name
  }) {
    return strapi.query('clash-user').delete({
      name
    })
  }
};
