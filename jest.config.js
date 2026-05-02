/** @type {import('jest').Config} */
export default {
    testEnvironment: "node",
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
