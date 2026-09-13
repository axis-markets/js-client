const path = require('path')
const webpack = require('webpack')

module.exports = function () {
    return {
        mode: 'production',
        devtool: 'source-map',
        entry: {
            axisClient: {
                import: path.join(__dirname, '/src/cjs.js'),
                filename: 'axis-client.cjs',
                library: {
                    name: 'axisClient',
                    type: 'umd',
                    export: 'default'
                }
            },
            axisFootprint: {
                import: path.join(__dirname, '/src/footprint-cjs.js'),
                filename: 'footprint.cjs',
                library: {
                    name: 'axisFootprint',
                    type: 'umd',
                    export: 'default'
                }
            }
        },
        output: {
            path: path.join(__dirname, './lib'),
            globalObject: 'this',
            clean: true
        },
        module: {
            rules: [
                {
                    test: /\.js?$/,
                    loader: 'babel-loader',
                    exclude: /node_modules/
                }
            ]
        },
        externalsType: 'umd',
        externals: {
            '@stellar/stellar-sdk': '@stellar/stellar-sdk'
        },
        plugins: [
            new webpack.DefinePlugin({
                'process.env.NODE_ENV': JSON.stringify('production')
            })
        ],
        optimization: {
            minimize: true
        }
    }
}
