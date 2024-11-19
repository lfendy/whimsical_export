# whimsical-exporter

CLI tool to export your [Whimsical](https://whimsical.com) boards recursively as SVG, PNG, or PDF from a starting folder URL.

## Note:

This is a fork of https://github.com/FdezRomero/whimsical-exporter

## Features

- Exports folders and boards recursively, keeping the same folder structure.
- Allows selecting the exporting formats:
  - PNG at 2x zoom (static image, shapes cannot be edited)
  - PDF (landscape, shapes can be zoomed in)
  - SVG (shapes can be zoomed in and edited)
- If the process fails, you can run the same command again and it will skip existing files.
- Automatically skips empty boards.
- All code is run locally in your machine taking control of your existing browser with debugging port.
- Your login credentials are never stored or shared.

## Requirements

- Node.js v16+
- Chrome with debugging port enabled

## Usage

Clone the repo and install the dependencies with `npm install`, then run it with `npm start`.

The interactive tool will ask you for your email, password, the URL you want to start exporting from, and the image formats you prefer and will save the files with the same folder structure in a `downloads` folder on your working directory.

If you plan to run this tool several times, you can also pass these options as environment variables:

```
WS_URL='ws://xxx' FOLDER_URL='https://whimsical.com/your-folder-name' FILE_TYPES='svg,png,pdf' npm start
```

## License

© Rodrigo Fernández, MIT license.
