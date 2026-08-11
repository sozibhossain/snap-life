const appJson = require("./app.json");

module.exports = () => {
  const config = appJson.expo;
  const allowInsecureHttp =
    process.env.EXPO_PUBLIC_ALLOW_INSECURE_HTTP === "true";

  return {
    ...config,
    ios: {
      ...config.ios,
      infoPlist: {
        ...config.ios.infoPlist,
        ...(allowInsecureHttp
          ? {
              NSAppTransportSecurity: {
                NSAllowsArbitraryLoads: true,
              },
            }
          : {}),
      },
    },
  };
};
