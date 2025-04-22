windows VM

 - install Env
install git 
install node.js + npm

- install dependencies
npm install -g yo generator-code
npm install -g typescript

- create project
yo code
```
Choose options:
Type: New Extension (TypeScript)

Name: Profiling Data Visualizer

Identifier: profiling-data-visualizer

Description: Visualize profiling data in VS Code

Publisher: Your name or a unique ID (e.g., yourname)

Initialize Git: Yes

Package Manager: npm
```


check vscode version and vscode engine version in `package.json` 

src/extension.ts + `F5`




Development
```bash
npm install 
# npm install d3
npm run compile
```


Publish 
```bash
npm install -g vsce
# to vsix 
vsce package 

vsce publish
```




