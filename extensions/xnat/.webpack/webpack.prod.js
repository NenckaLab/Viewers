const path = require('path');
const pkg = require('../package.json');

const outputFile = 'index.umd.js';
const rootDir = path.resolve(__dirname, '../');
const outputFolder = path.join(__dirname, `../dist/umd/${pkg.name}/`);
const CopyPlugin = require('copy-webpack-plugin');

// Todo: add ESM build for the extension in addition to umd build

const config = {
    mode: 'production',
    entry: rootDir + '/' + pkg.module,
    devtool: 'source-map',
    output: {
        path: outputFolder,
        filename: outputFile,
        library: pkg.name,
        libraryTarget: 'umd',
        chunkFilename: '[name].chunk.js',
        umdNamedDefine: true,
        globalObject: "typeof self !== 'undefined' ? self : this",
    },
    externals: [{
        react: {
            root: 'React',
            commonjs2: 'react',
            commonjs: 'react',
            amd: 'react',
        },
        '@ohif/core': {
            commonjs2: '@ohif/core',
            commonjs: '@ohif/core',
            amd: '@ohif/core',
            root: '@ohif/core',
        },
        '@ohif/ui': {
            commonjs2: '@ohif/ui',
            commonjs: '@ohif/ui',
            amd: '@ohif/ui',
            root: '@ohif/ui',
        },
    }, ],
    module: {

        rules: [{
                test: /\.svg?$/,
                oneOf: [{
                    use: [{
                        loader: '@svgr/webpack',
                        options: {
                            svgoConfig: {
                                plugins: [
                                    new CopyPlugin({
                                        patterns: [{
                                            from: '../../../node_modules/onnxruntime-web/dist',
                                            to: `${DIST_DIR}/ort`,
                                        }, ],
                                    }),
                                    {
                                        name: 'preset-default',
                                        params: {
                                            overrides: {
                                                removeViewBox: false
                                            },
                                        },
                                    },
                                ]
                            },
                            prettier: false,
                            svgo: true,
                            titleProp: true,
                        },
                    }, ],
                    issuer: {
                        and: [/\.(ts|tsx|js|jsx|md|mdx)$/],
                    },
                }, ],
            },
            {
                test: /(\.jsx|\.js|\.tsx|\.ts)$/,
                loader: 'babel-loader',
                exclude: /(node_modules|bower_components)/,
                resolve: {
                    extensions: ['.js', '.jsx', '.ts', '.tsx'],
                },
            },
        ],
    },
    resolve: {
        modules: [path.resolve('./node_modules'), path.resolve('./src')],
        extensions: ['.json', '.js', '.jsx', '.tsx', '.ts'],
    },
};

module.exports = config;