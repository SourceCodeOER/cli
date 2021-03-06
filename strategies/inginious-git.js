const simpleGitModule = require('simple-git/promise');
const FileHound = require('filehound');
const partition = require('lodash.partition');
const groupBy = require('lodash.groupby');

const yaml = require('js-yaml');
const {readFileSync, existsSync} = require("fs");
const child_process = require("child_process");

const path = require("path");
const dirname = path.dirname;
const slash = require('slash');
const isAbsoluteUrl = require('is-absolute-url');

const exists = (dir) => {
    try {
        return existsSync(dir);
    } catch (e) {
        return false;
    }
};

const rst2md = (str) => {
    try {
        const result = child_process.spawnSync(
            "pandoc",
            ["--from=rst", "--to=html5", "--no-highlight"],
            {input: str, encoding: "utf-8"}
        );
        return result.stdout;
    } catch (e) {
        // Should ever occur but who knows ?
        console.log(e);
        return "An error occurs during conversion from RST TO Markdown : please retry or give up";
    }
};

// Handle tag crawling for INGINIOUS tasks on one GIT
module.exports = async function (options) {
    const {
        workingDirectory,
        url: gitURL
    } = options;

    // git clone the given folder in workingDir
    const simpleGit = simpleGitModule(workingDirectory);
    const folderName = gitURL.substr(gitURL.lastIndexOf("/") + 1).replace(/\.git/, "");
    const gitFolder = path.resolve(workingDirectory, "./" + folderName);

    try {
        // check if given git folder already exist, to prevent stupid re cloning
        const folder_exists = exists(gitFolder);
        if (!folder_exists) {
            // Clone the given git
            await simpleGit.clone(gitURL);
        }

        // Find course.yaml and task.yaml files
        const files = await FileHound
            .create()
            .paths(gitFolder)
            .ext("yaml")
            // some inginious tasks use config files like "feedback_settings.yaml", exclude them from result)
            .glob("*course.yaml", "*task.yaml")
            .find();

        // separate the course(s) and task(s) data
        const [courses_data, exercises_data] = partition(files, (file) => file.endsWith("course.yaml"));

        // the hard part here
        // As Inginious uses at least 2 versions for their tag system, this script tries to handle both :
        // In V1, tags can be directly found in their task.yaml
        // In V2, they must be first present in course.yaml , then referenced in task.yaml

        // 1. Get a dictionary of course metadata
        const courses = groupBy(
            courses_data
                .map(course_data => {
                        // parse the given yaml file
                        const doc = yaml.safeLoad(readFileSync(course_data, 'utf8'));
                        // if we can find some tags, extract them
                        return {
                            "all_tags": extract_tags(doc, "tags"), // all the given tags
                            "name": doc.name,
                            "path": course_data, // useful for later
                        };
                    }
                )
            , "path");

        // 2. Get an array of tags metadata
        // As said before, V1 and V2 have a few differences :
        // for a task, V2 only use the tags under the "categories" key of a task.yaml
        // for V1

        // Copied from https://github.com/UCL-INGI/INGInious/blob/master/inginious/common/tags.py
        // as it is referred nowhere in INGINIOUS docs :
        /*
            The 'type' represents the behaviour of the tag:
            - 0: Skill tags. It appear in blue. When the tag is activated it becomes green.
                 We can perform tasks search on this tag.
            - 1: Misconception tags. It does not appear until it is activated. It appear in red when activated.
                 We can NOT perform tasks search on this tag.
                 The tags are useful to highlight errors or misconceptions.
            - 2: Category tags. Never appear. Only used for organisation and when we perform tasks search.
        */
        const exercises = exercises_data.map(exercise_data => {
            // parse the given yaml file
            const doc = yaml.safeLoad(readFileSync(exercise_data, 'utf8'));
            // if we can find the related course metadata , use that to get more info on this exercise
            // Warning : as path , we must take the most specialized one ( aka the longest string )
            const course_match = Object
                .keys(courses)
                .filter(s => exercise_data.includes(dirname(s)))
                .reduce((a, b) => a.length > b.length ? a : b, '');
            const course_data = (course_match.length > 0) ? courses[course_match][0] : {};

            // To distinguish categories, I must have a criteria :
            // If the tag has the "autoGenerated" flag set to "true", it means the category is coming from the generator
            // For security, I use _ around the name to prevent match(s) with others
            let auto_tags = auto_generate_tags_for_exercise(gitURL, options, course_data, doc);

            // all the given tags by users
            // as Inginious also have "garbage" tags (the one with category 1)
            let found_tags = found_tags_for_exercise(course_data, doc)
                .filter(tag => (tag["category"] !== 1));

            let exercise = {
                "title": doc.name,
                // We must improve description before serve that into a json file
                "description": clean_inginious_links(
                    rst2md(
                        (doc.hasOwnProperty("context")) ? doc.context : "" // it is optional on Inginious
                    ),
                    // the optional inginious URL given by properties
                    (options.hasOwnProperty("inginiousURL"))
                        ? options.inginiousURL
                        : ""
                ),
                "tags": auto_tags.concat(found_tags) // merge them in a single array
            };

            // if the base course inginious url was given , try to infer the inginious task link
            // Only valid for github that have a single course : for multiple, it is too rare (and much more complex )
            if (options.hasOwnProperty("inginiousURL")) {
                const folder_exercise = path.relative(gitFolder, dirname(exercise_data));
                exercise["url"] = `${options.inginiousURL}/${folder_exercise}`
            }

            // To allow file uploads, we need some extra metadata
            if (course_match.length > 0) {
                exercise["archive_properties"] = {
                    // relative path, in order to be cross platform and handle multiple cases
                    // So I used / instead of the ugly \\ of Windows for path
                    "folders": [slash(path.relative(gitFolder, dirname(exercise_data)))],
                    "files": [slash(path.relative(gitFolder, course_match))]
                }
            }

            // Time to clean the title and maybe add a new tag
            return handle_exercise_title(exercise);
        });

        return {
            "exercises": exercises,
            // if the given platform has its own categories for tag, use them
            "own_categories": {
                0: "thématique",
                1: "Misconception",
                2: "autres"
            },
            // date of creation
            "extraction_date": new Date(),
            "url": gitURL
        }


    } catch (e) {
        console.error(e);
        return {};
    }

};

// function to extract tags in the given yaml file object, under the given rootLey
function extract_tags(doc, rootLey) {
    if (doc.hasOwnProperty(rootLey)) {
        // only takes their id, text and type attributes
        // rest like "visible", "description", etc.. aren't useful for us (yet)
        return Object
            .entries(doc[rootLey])
            .reduce((acc, [key, value]) => {
                // to handle both V1 and V2 case as tags can be found in course.yaml and task.yaml
                // In LSINF1252, they used unvalidated tags in their task.yaml
                const real_key = (value.hasOwnProperty("id")) ? value.id : key;
                acc[real_key] = {
                    id: real_key,
                    text: value.name,
                    category: value.type
                };
                return acc;
            }, {});
    } else {
        return {};
    }
}

// Function to add autogenerated Tag for given exercise
function auto_generate_tags_for_exercise(gitURL, options, course_data, exercise_data) {
    let tags = [];

    // add platform of this exercise : INGINIOUS
    tags.push({
        text: "INGINIOUS",
        autoGenerated: true,
        category_id: "_PLATFORM_"
    });

    // add the source url of this exercise
    tags.push({
        text: gitURL,
        autoGenerated: true,
        category_id: "_SOURCE_"
    });

    // If given, add the license SPDX Identifier
    if (options.hasOwnProperty("license") && options.license.length > 0) {
        tags.push({
            text: options.license,
            autoGenerated: true,
            category_id: "_LICENSE_"
        })
    }

    // If we can retrieve the course name, we could add course as tag
    if (course_data.hasOwnProperty("name") && course_data.name.length > 0) {
        tags.push({
            text: course_data.name,
            autoGenerated: true,
            category_id: "_COURSE_"
        })
    }

    // If we can retrieve the author(s), we could add author as tag
    if (exercise_data.hasOwnProperty("author")) {
        // handle multiple authors
        // example(s) :
        // Author 1 , Author 2
        // Author 1 && Author 2
        // Author 1 & Author 2
        exercise_data
            .author
            .split(new RegExp("(?:\,|\&{1,2})", "g"))
            .map(s => s.trim()) // remove leading space
            .filter(s => s.length > 0) // no empty author
            .map(s => s.replace(/\s*\(.*?\)\s*/g, '')) // credits to genius in CS1 for violating regular convention
            .forEach((author) => {
                tags.push({
                    text: author,
                    autoGenerated: true,
                    category_id: "_AUTHOR_"
                })
            });
    }

    // If we can correctly predict the language and kind of exercise, it will be a huge improvement
    if (exercise_data.hasOwnProperty("problems")) {

        // Two major problem categories can be found : text or code
        const text_type = ["multiple_choice", "match"];
        const code_type = ["code", "code_single_line"];

        // to correctly determine what kind of problem we have inside this exercise
        const metadata = Object
            .values(exercise_data.problems)
            .map(currentProblem => {

                // For text, it is easy
                if (text_type.includes(currentProblem.type)) {
                    return {"category": "text", "type": currentProblem.type}
                }

                // For code, least easy
                if (code_type.includes(currentProblem.type)) {
                    return {
                        "category": "code",
                        "type": currentProblem.type,
                        // language can be present (or not), if not, try to infer that
                        "language": find_language_of_a_problem(currentProblem)
                    };
                }

                // skip this element if not match one of the previous case
                return {};
            })
            .filter(obj => obj !== {});

        // Now, it is decision time
        const [code_problems, text_problems] = partition(metadata, obj => obj.category === "code");
        const at_least_one_code = code_problems.length > 0;
        const at_least_one_text = text_problems.length > 0;

        // Takes everything (maybe later a more advanced mechanism

        [].concat(
            ...[
                (at_least_one_code)
                    ? handle_code_problem(code_problems)
                    : [],
                (at_least_one_text)
                    ? handle_text_problem(text_problems)
                    : []
            ]
        ).forEach((tag) => {
            tags.push(tag);
        });

    }

    return tags;
}

function found_tags_for_exercise(course_data, exercise_data) {

    // V2 : tags can be found in "categories" key in task.yaml
    // It is only an array of ids so we must retrieve the full tag data from course.yaml
    let tags = (exercise_data.hasOwnProperty("categories"))
        ? exercise_data.categories
            .map(categoryId => course_data.all_tags[categoryId])
        // V1 : tags can be found in "tags" key in task.yaml
        :
        Object.values(
            extract_tags(exercise_data, "tags")
        );

    // Remove unused properties ( id )
    tags.forEach(function (v) {
        delete v.id
    });

    return tags;
}

// To easy find if we can retrieve the language of a tag
const DEFAULT_LANGUAGE = "UNKNOWN";

function find_language_of_a_problem(problem) {
    // language can be present (or not), if not, try to infer that
    const header_regex = RegExp("\.\. code-block:: (\\w+)");
    let language = DEFAULT_LANGUAGE;

    // the most simple case : directly found the language
    if (problem.hasOwnProperty("language") && problem.language.length > 0) {
        language = problem.language;
    }

    // We could try extract possible language in header
    if (language === DEFAULT_LANGUAGE && problem.hasOwnProperty("header")) {
        // we found a match
        if (header_regex.test(problem.header)) {
            language = problem.header.match(header_regex)[1]
        }
    }

    // Least try : hope we can found something in boxes
    if (language === DEFAULT_LANGUAGE && problem.hasOwnProperty("boxes")) {
        const matches = Object
            .values(problem.boxes)
            .filter(box_problem => box_problem.hasOwnProperty("language"))
            .map(box_problem => box_problem.language);
        // Takes the first result : should be probably the good language
        if (matches.length > 0) {
            language = matches[0];
        }
    }

    // If none of the previous if, BLAME the people who create the task
    // I cannot do all your job ^^
    return language;
}

// to handle problem types
// for text
function handle_text_problem(text_problems) {
    // More text that code : probably QCM
    const found_types = text_problems.map(s => s.type);
    const exercise_type = found_types.includes("multiple_choice") ? "multiple_choice" : "match";

    return [{
        autoGenerated: true,
        category_id: "_EXERCISE-TYPE_",
        text: exercise_type
    }];
}

// for code
function handle_code_problem(code_problems) {
    // More code that text : probably code

    // Add at least the kind of exercise
    let tags = [{
        autoGenerated: true,
        category_id: "_EXERCISE-TYPE_",
        text: "code"
    }];

    const languages = code_problems
        .map(s => s.language)
        .filter(s => s !== DEFAULT_LANGUAGE)
        .map(l => l.toLowerCase());

    // Add the found language(s) in exercise
    [...new Set(languages)].forEach((language) => {
        tags.push({
            autoGenerated: true,
            category_id: "_PROGRAMMING-LANGUAGE_",
            text: language
        });
    });

    // Add the default language if I found nothing
    if (languages.length === 0) {
        tags.push({
            autoGenerated: true,
            category_id: "_PROGRAMMING-LANGUAGE_",
            text: DEFAULT_LANGUAGE
        });
    }

    return tags;
}

// To purge exercise title from most ugly things I saw in Inginious + maybe add some unseen tags
function handle_exercise_title(exercise) {

    // to find match, to prevent duplicate tag entries
    const existOne = (tag) => exercise
        .tags
        .some(tag2 => {
            const same_kind = (
                ([tag, tag2].every((match) => match.hasOwnProperty("autoGenerated")))
                ||
                ([tag, tag2].every((match) => !match.hasOwnProperty("autoGenerated")))
            );
            const is_autogenerated = tag.hasOwnProperty("autoGenerated");
            const category_field = (is_autogenerated) ? "category_id" : "category";
            return same_kind && (tag[category_field] === tag2[category_field]) && (
                tag["text"].toLowerCase() === tag2["text"].toLowerCase()
            );
        });

    // If someone wants to add/update/improve them ; good luck ;)
    const common_pattern = [
        // to match exam - like exercise
        /\[((?:Septembre|Juin)\s[0-9]{4,}).*\](.+)$/im,
        /EXAM.+\s-(.+)$/im,
        // to match midterm - like exercise ( from my analysis, only see that two times but who knows ?)
        /mid\-?term(.+)$/im,
        // to match mission - like exercise
        /(?:Bilan\sM|Mission)\s?([0-9])+[\s|\-|:]*(.+)$/im,
        // to match some categorized - like exercise ( often by week : S2)
        /\[(.+)\]\s(.+)$/im,
        // to clean a garbage title commonly seen
        /PART\s[0-9]+\s-(.+)$/im
    ];

    const title = exercise.title;
    const is_a_exam = [common_pattern[0], common_pattern[1]].some((pattern) => pattern.test(title));
    const [is_a_midterm, is_a_mission, is_categorized_exercise, is_garbage_title] = common_pattern
        .slice(2)
        .map((pattern) => pattern.test(title));

    // array to store new tags proposal, if they don't already exist
    const tag_proposals = [];
    let matches; // to handle regex match

    // more elegant way that if cascades
    switch (true) {
        case is_a_exam:

            // in any case, we should add a new tag to tell exercise kind, if not already the case
            tag_proposals.push({
                "autoGenerated": true,
                "category_id": "_EXERCISE-TYPE_",
                "text": "exam"
            });
            const pattern_index = (common_pattern[0].test(title)) ? 0 : 1;
            matches = title.match(common_pattern[pattern_index]);
            if (pattern_index === 0) {
                tag_proposals.push({
                    "category": 2,
                    "text": matches[1].trim()
                });
                exercise.title = matches[2].trim();
            } else {
                exercise.title = matches[1].trim();
            }
            break;

        case is_a_midterm:

            matches = title.match(common_pattern[2]);
            exercise.title = matches[1].trim();
            // in any case, we should add a new tag to tell exercise kind, if not already the case
            tag_proposals.push({
                "autoGenerated": true,
                "category_id": "_EXERCISE-TYPE_",
                "text": "midterm"
            });
            break;

        case is_a_mission || is_categorized_exercise:

            let pattern = common_pattern[(is_a_mission) ? 3 : 4];
            matches = title.match(pattern);
            exercise.title = matches[2].trim();
            const tag_text = (is_a_mission)
                ? "Mission " + matches[1].trim()
                : matches[1].trim();
            tag_proposals.push({
                "category": 2,
                "text": tag_text
            });
            break;

        case is_garbage_title:
            matches = title.match(common_pattern[5]);
            exercise.title = matches[1].trim();
            break;

        default:
            // do nothing, I cannot clean all the mess titles in Inginious by myself ^^
            break;
    }

    // insert the new tags if they don't already exist
    exercise["tags"] = exercise["tags"].concat(
        tag_proposals.filter(tag => !existOne(tag))
    );

    return exercise;
}

// regex useful to clean inginious links
const img_html_regex = /<img[^>]+src="([^">]+)"/gm; // as pandoc links always start by src, it should work as expected
const links_regex = /<a href="([^">]+)"/gm; // only takes link part : [](thisOne) - result : thisOne

// To handle links inside markdown since Inginious links are a real mess
function clean_inginious_links(description, inginious_link) {
    // some reading for people that never read documentation ^^
    // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/replace

    // maybe useful for some scenario
    const getRootUrl = inginious_link.replace(/^(.*\/\/[^\/?#]*).*$/, "$1");

    // To  solve nasty links found
    const url_solver = (givenUrl) => {

        // conner case for links of LSINF1252 - some links are literally broken like
        // like "%60printf%20%3Chttps://sites.uclouvain.be/SystInfo/manpages/man3/sprintf.3.html"
        if (givenUrl.startsWith("%")) {
            givenUrl = givenUrl.replace(/\%.*http/, "http");
        }

        // if already an absolute link, no work to do or
        // if no inginiousURL in settings, cannot infer the real link
        if (isAbsoluteUrl(givenUrl) || inginious_link.length === 0) {
            return givenUrl;
        }

        // Two kinds of ugly relative links exists on inginious
        // Type 1 : like ( "PART3Bst/bst.png" ) : relative to a course url
        // Type 2 : like ( "/course/LEPL1402/BoundedBuffer/BoundedBuffer.png" ) : relative to root path

        // If Type 1, we can append the given link with this part (it is relative to the course)
        return (!givenUrl.startsWith("/"))
            ? inginious_link + "/" + givenUrl
            : getRootUrl + givenUrl;
    };

    // purge description of nasty broken inginious links
    return description
        .replace(links_regex, (_match, p1, p2) => `<a href="${url_solver(p1)}"`)
        .replace(img_html_regex, (_match, p1) => `<img src="${url_solver(p1)}"`);
}
