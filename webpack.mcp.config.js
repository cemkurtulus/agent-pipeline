//@ts-check
'use strict';

const path = require('path');

/** @type {import('webpack').Configuration} */
const mcpConfig = {
  target: 'node',
  mode: 'none',
  entry: './src/mcp/server.ts',
  output: {
    path: path.resolve(__dirname, 'dist', 'mcp'),
    filename: 'server.js',
    libraryTarget: 'commonjs2',
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [{ loader: 'ts-loader' }],
      },
    ],
  },
  devtool: 'nosources-source-map',
};

module.exports = mcpConfig;
