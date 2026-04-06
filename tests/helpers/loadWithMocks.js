const Module = require("module");

const loadWithMocks = (modulePath, mocks = {}) => {
  const originalLoad = Module._load;

  Module._load = function patchedLoad(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) {
      return mocks[request];
    }

    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    delete require.cache[require.resolve(modulePath)];
    return require(modulePath);
  } finally {
    Module._load = originalLoad;
  }
};

module.exports = { loadWithMocks };
