git add upstream https://github.com/jackyzha0/quartz.git
git pull upstream v4

git submodule add git@github.com:taedi90/post-archive.git content 

brew install node@22


npm i

npx quartz build --serve

npx quartz sync