# SourceCode-cli 

The purpose of this cli tool is to easily bulky export / import exercises for the API. 

## Requirements

- [Pandoc](https://pandoc.org/) (for the description conversion)

## Installation

```sh
npm install --save-dev @sourcecodeoer/cli
```

## What are the available commands / options ?

This tool was build on top of [yargs](http://yargs.js.org/).  
For the full list of commands and options, everything is explained with the help command :

```sh
npx sourcecode-cli --help
```

## How does it works ?

To be platform independent, we define the following rule :  
Each **result file** generated by one of the commands must following our [specification](#what-is-the-format-of-the-json-object-).  
Of course, nothing blocks you to extend our [specification](#what-is-the-format-of-the-json-object-) for your own purpose.

## What is the format of the JSON object ?

An small example before explanation :

```json
{
   "exercises":[
      {
         "title":"An exercise",
         "description": "Some description here",
         "url": "https://inginious.info.ucl.ac.be/courselist",
         "tags":[
            {
               "autoGenerated":true,
               "category_id":"_PROGRAMMING-LANGUAGE_",
               "text":"c"
            },
            {
               "text": "S3",
               "category": 2
            }
         ]
      }
   ],
   "own_categories":{
      "0":"thématique",
      "1":"Misconception",
      "2":"autres"
   },
   "extraction_date": "2019-11-26T14:04:34.107Z",
   "url": "https://github.com/UCL-INGI/LSINF1252"
}
```
Only two properties are required inside : `"exercises"` and `"own_categories"`.  
Extra properties can be defined if you want (like `"extraction_date"` and `"url"` to keep track of the source / extraction date).

Inside the key `"exercises"` , we have an array of exercises metadata.  
As described in the endpoint [/api/bulk_create_exercises](https://sourcecodeoer.github.io/sourcecode_api/#operation/createMultipleExercises),
some attributes for an exercise are required  
(like `"title"`, `tags`, `description`) whereas some are optional (like `"url"` or `"file"`).

As you can see, whatever the platform, there is some common tags categories that should be used whenever it is possible.
An possible [example](default_auto_generated_tags.json) might be: 

```json
{
   "_PLATFORM_":"plateforme",
   "_SOURCE_":"source",
   "_COURSE_":"cours",
   "_EXERCISE-TYPE_":"type d'exercice",
   "_PROGRAMMING-LANGUAGE_":"langage",
   "_AUTHOR_":"auteur"
}
```

To distinguish them from your own tag categories, when you used one of them for a tag, we must specify the property 
`"autoGenerated"` to `true` and `category_id` to the right key of previously explained object :

```json
{
   "autoGenerated":true,
   "category_id":"_PROGRAMMING-LANGUAGE_",
   "text":"c"
}
```

For tags categories of your own platform, You must describe them in `"own_categories"` property as an mapping object :
(`{}` if you have none)

```json
{
   "0":"thématique",
   "1":"Misconception",
   "2":"autres"
}
```

Then use them in tags as shown in the example (`"category"` with your own key) :
```
{
   "text":"S3",
   "category":2
}
```

If you wish to add the sources of an exercise, it should be a zip file. 

Two choices are possible :

1. **If you already have the file**, you should use the key `"file"` with value a absolute path of this file :

```json
{
   "file": "/home/jy95/folder/mysources.zip"
}
```

2. **If you don't have the file**, you can delegate the creation of zip file to `archiver` command thanks to the key `"archive_properties"` structured like that :

```json
{
  "archive_properties": {
    "folders": [],
    "files": []
  }
}
```
These two sub properties must be present : use an empty array if you don't have any folder or file.
Each item of these arrays should be relative path so `archiver` can build the absolute path with the option `baseFolder` (in case you change location of an exercise folder afterward)
and automatically add the `"file"` property in each exercise.

Using the property `"file"` in each exercise, the `uploader` command will do for you the mapping between files and exercises when you want to upload exercises into the API. 
(don't forget to use option `auto_generated_tags_categories` in `uploader` if you used other common tag categories)

## Which strategies are available by default for crawler ?

- [inginious-git](strategies/inginious-git.js) : for INGInious tasks / course(s) stored on a git repository

## How to design a new strategy for crawler ?

Simply create a module file that looks like this :

```node
module.exports = async function (options) {
   // TODO
}
```

This module should return an valid object to the [specification](#what-is-the-format-of-the-json-object-).  
The given `options` parameter is simply the [argv object created by yargs](http://yargs.js.org/docs/#api-argv).  
Check out [inginious-git](strategies/inginious-git.js) if you want to see an example about how to use it.