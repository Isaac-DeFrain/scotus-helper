/** @type {import('jest').Config} */
const jestConfig = {
  testEnvironment: "node",
  modulePathIgnorePatterns: ["<rootDir>/.next/"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: {
          module: "commonjs",
          moduleResolution: "node",
          rootDir: ".",
          ignoreDeprecations: "6.0",
        },
      },
    ],
  },
};

export default jestConfig;
