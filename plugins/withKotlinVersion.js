const { withProjectBuildGradle } = require("@expo/config-plugins");

/**
 * Custom Expo Config Plugin to inject missing kotlinVersion 
 * into the top-level android/build.gradle.
 */
const withKotlinVersion = (config) => {
  return withProjectBuildGradle(config, (config) => {
    if (config.modResults.language === "gradle") {
      let content = config.modResults.contents;
      
      // Check if ext block with the variable assignment already exists
      if (!content.includes("kotlinVersion =")) {
        // Find the start of buildscript
        const buildscriptIndex = content.indexOf("buildscript {");
        if (buildscriptIndex !== -1) {
          // Find the opening brace index
          const openingBraceIndex = content.indexOf("{", buildscriptIndex);
          if (openingBraceIndex !== -1) {
            const extBlock = `
  ext {
    buildToolsVersion = "35.0.0"
    minSdkVersion = 24
    compileSdkVersion = 35
    targetSdkVersion = 34
    kotlinVersion = "2.0.0"
  }\n`;
            // Insert ext block after the opening brace of buildscript
            content = content.slice(0, openingBraceIndex + 1) + 
                     extBlock + 
                     content.slice(openingBraceIndex + 1);
            
            config.modResults.contents = content;
          }
        }
      }
    }
    return config;
  });
};

module.exports = withKotlinVersion;
