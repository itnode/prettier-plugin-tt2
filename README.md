# prettier-plugin-tt2

# How to use with VS Code

## Install Prettier locally in the project
* Install the VS Code Extention "Prettier - Code formatter" ( esbenp.prettier-vscode )
* *( In the project root )* `npm install --save-dev prettier prettier-plugin-tt2@latest`
* Configure Prettier through extention or with a ".prettierrc" file.

* (optional) Configure format on save in VS Code
    * File > Preferences > Settings 
    * Search for "format on save" and enable "Editor: Format On Save"


Example `.prettierrc`: 
```json
{
  "plugins": ["prettier-plugin-tt2"],
  "tabWidth": 2,
  "printWidth": 80,
  "bracketSameLine": true
}
```  

If you dont want Linebreaks because of long Lines you could change the "printWidth" to some large value like 8000.

<br/>

## Update the Plugin

* Reinstall the plugin with: `npm install -D prettier-plugin-tt2@latest`

<br/>

## It is possible to install Prettier globally but not recommended by Prettier.

To install Prettier globally: 
* `npm install -g prettier prettier-plugin-tt2@latest`
* In VS Code Prettier Settings enable "Prettier: Resolve Global Modules"
* Contiune with configuring prettier ...
