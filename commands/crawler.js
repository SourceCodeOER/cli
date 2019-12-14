#!/usr/bin/env node
const path = require('path');
const {promises: fs, readFileSync} = require("fs");
const PATH_FOR_STRATEGY = path.resolve(__dirname, "..", "./strategies");
const DEBUG_FILE = path.resolve("./results.json");

exports = module.exports = {
    "command": "crawler",
    "describe": "export metadata from your exercises to Source Code",
    "builder": function (y) {
        return y
            .option("strategy", {
                alias: "s",
                type: "string",
                description: "Name of the already implemented strategy you want to use",
                choices: ["inginious-git"]
            })
            .option("custom_strategy", {
                alias: "cs",
                type: "string",
                conflicts: "strategy",
                description: "Absolute path to a JS file implementing your strategy (see docs for more info)"
            })
            .option("workingDirectory", {
                alias: "w",
                type: "string",
                description: "Absolute path to a folder where the crawler can do its stuff",
                demandOption: true
            })
            .option("resultFile", {
                alias: "out",
                type: "string",
                description: "Absolute path to a JSON file the crawler could write its results",
                default: DEBUG_FILE
            })
            .coerce("workingDirectory", (arg) => {
                return path.resolve(arg);
            })
            .config("settings", "Absolute path to a JSON config file for strategy + crawler", (configPath) => {
                return JSON.parse(readFileSync(path.resolve(configPath), 'utf-8'));
            })
            .help()
            .argv;
    },
    "handler": function (argv) {
        fs
            .mkdir(argv.workingDirectory, {recursive: true})
            .then(() => fetch_and_save_results(argv))
            .catch((err) => {
                console.error(err);
            });
    }
};

async function fetch_and_save_results(argv) {
    // If custom script, invoke this to get results
    try {
        const results =
            (argv.hasOwnProperty("custom_strategy"))
                ? await require(argv.custom_strategy)(argv)
                : await require(path.resolve(PATH_FOR_STRATEGY, argv.strategy))(argv);

        await fs.writeFile(argv.resultFile, JSON.stringify(results, null, 4));
        console.log("SUCCESSFULLY SAVED THE RESULTS");
        return await Promise.resolve(results)
    } catch (e) {
        return await Promise.reject(e);
    }
}