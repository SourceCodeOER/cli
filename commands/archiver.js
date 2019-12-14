const {promises: fs, readFileSync, existsSync, createWriteStream} = require("fs");
const path = require("path");
const archiver = require('archiver');

exports = module.exports = {
    "command": "archiver",
    "describe": "Generate zip archives from exercises using the crawler JSON results file",
    "builder": function (y) {
        return y
            .option("inputFile", {
                alias: "in",
                type: "string",
                description: "Absolute path to a JSON file the archiver could read crawler result",
                demandOption: true
            })
            .option("outputFile", {
                alias: "out",
                type: "string",
                description: "Absolute path to a JSON file the archiver could saves its results",
                demandOption: true
            })
            .option("baseFolder", {
                type: "string",
                description: "Absolute path to the base folder where are located the exercises described in inputFile",
                alias: "root",
                demandOption: true
            })
            .option("zipFolder", {
                type: "string",
                description: "Absolute path to a folder where we can stored the generated zip files",
                alias: "temp",
                demandOption: true
            })
            .config("settings", "Absolute path to a JSON config file for archiver", (configPath) => {
                return JSON.parse(readFileSync(path.resolve(configPath), 'utf-8'));
            })
            .coerce("baseFolder", (arg) => {
                return path.resolve(arg);
            })
            .coerce("zipFolder", (arg) => {
                return path.resolve(arg);
            })
            .coerce("outputFile", (arg) => {
                return path.resolve(arg);
            })
            .coerce("inputFile", (arg) => {
                return JSON.parse(readFileSync(path.resolve(arg), 'utf-8'));
            })
            .help()
            .argv;
    },
    "handler": function (argv) {
        // creates the temp folder if not exist yet to store zip files
        fs
            .mkdir(argv.zipFolder, {recursive: true})
            .then(() => add_zip_files_to_exercises(argv))
            .then((updated_exercises) => {
                // append results with previous object
                return Promise.resolve(Object.assign({}, argv.inputFile, {
                    "exercises": updated_exercises,
                    "archive_date": new Date()
                }));
            })
            .then((result) => fs.writeFile(argv.outputFile, JSON.stringify(result, null, 4)))
            .then(() => console.log("Correctly generate and add files to exercises"))
            .catch((err) => {
                console.error(err);
            });
    }
};

const exists = (dir) => {
    try {
        return existsSync(dir);
    } catch (e) {
        return false;
    }
};

// Zip file with max compression; to save space
const createZipArchive = () => archiver('zip', {
    zlib: {level: 9} // Sets the compression level.
});

// Credits to https://stackoverflow.com/a/1917041/6149867
function sharedStart(array){
    let A= array.concat().sort(), a1= A[0], a2= A[A.length-1], L= a1.length, i= 0;
    while(i<L && a1.charAt(i)=== a2.charAt(i)) i++;
    return a1.substring(0, i);
}

// To remove efficiently prefix in files / folders and handle multiple case
function length_of_common_prefix(prefix) {
    // cross platform solution
    const symbol = prefix.includes("/") ? "/" : "\\";
    const last_occurrence = prefix.lastIndexOf(symbol);
    return (last_occurrence === -1) ? 0 : last_occurrence
}

async function add_zip_files_to_exercises(argv) {

    return Promise.all(
        argv
            .inputFile
            .exercises
            .map(async (exercise, index) => handle_single_exercise(argv, exercise, index))
    );
}

// To handle a single exercise
async function handle_single_exercise(argv, exercise, index) {
// to skip some exercises that doesn't have file or have already a file
    if (!exercise.hasOwnProperty("archive_properties") || exercise.hasOwnProperty("file")) {
        return exercise;
    }
    // if we already have created the file but because of whatever error, we were unable to save it
    // We must strip out from title special characters :
    const clean_title = exercise.title.replace(/[&\/\\#,+()$~%.'":*?<>{}\[\]]/g, '');
    const filename = `SourceCode-exercise-${index}-${clean_title}.zip`;
    const storage_path = path.resolve(argv.zipFolder, filename);

    // Correct the mistake now
    if (exists(storage_path)) {
        return Object.assign({}, exercise, {
            file: storage_path
        })
    }

    // the file doesn't exist, we can create it , if conditions are meet
    if (exercise.hasOwnProperty("archive_properties")) {
        const archiveProperties = exercise.archive_properties;
        const something_to_add = [
            archiveProperties.files,
            archiveProperties.folders
        ].some((resource) => resource.length > 0);

        if (something_to_add) {
            // set up variables needed for that
            let archive = createZipArchive();
            let output = createWriteStream(storage_path);
            // as it is better to have a flat structure inside the zip file , we must strip the common prefix out
            const commonPrefixLength = length_of_common_prefix(
                sharedStart([
                    ...archiveProperties.folders,
                    ...archiveProperties.files
                ])
            );

            // thanks to relative path, we can have a clean archive
            // add directories
            for (const folder of archiveProperties.folders) {
                const folderPath = path.resolve(argv.baseFolder, folder);
                archive.directory(folderPath, folder.substring(commonPrefixLength));
            }
            // add files
            for (const file of archiveProperties.files) {
                const filePath = path.resolve(argv.baseFolder, file);
                archive.file(filePath, {name: file.substring(commonPrefixLength)});
            }

            // pipe archive data to the file
            archive.pipe(output);

            // Wait for completion
            await archive.finalize();

            // Finally, add this file into the exercise
            return Object.assign({}, exercise, {
                file: storage_path
            })
        }
    } else {
        return exercise;
    }
}