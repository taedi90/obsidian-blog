#!/bin/bash

HERE="$( cd "$(dirname "$0")" ; pwd -P )"
CONTENT_DIR_PATH="${HERE}/content"
SOURCE_DIR_PATH="${HERE}/../Publish"

if [ ! -d "${SOURCE_DIR_PATH}" ]; then
    echo "ERROR ::: ${SOURCE_DIR_PATH} not found!"
    exit 1
fi

echo pull content

if [ -d "${CONTENT_DIR_PATH}" ]; then
    rm -rf "${CONTENT_DIR_PATH}"
fi

cd "${HERE}"
git filter-branch --force --index-filter "git rm -r --cached --ignore-unmatch content/" --prune-empty --tag-name-filter cat -- --all

rsync -avz "${SOURCE_DIR_PATH}/" "${CONTENT_DIR_PATH}"

echo sync
npm i
npx quartz sync

echo done.