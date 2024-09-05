#!/bin/bash

HERE="$( cd "$(dirname "$0")" ; pwd -P )"

echo pull content
cd "${HERE}/content"
git pull

echo sync
cd "${HERE}"
npx quartz sync

echo done.