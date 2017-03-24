module.exports = function () {
  return {
    files: [
      'src/**/*.ts'
    ],

    tests: [
      'test/**/*.ts'
    ],

    setup: function () {
      global.expect = require('chai').expect;
    },

    env: {
      type: 'node',
      runner: 'node'
    },

    testFramework: 'mocha'
  };
};