module.exports = {
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['jest-chrome'],
  testMatch: ['**/tests/unit/**/*.test.js'],
  transform: {
    '^.+\\.js$': 'babel-jest',
  },
  collectCoverageFrom: [
    'src/background.js',
    'src/content.js',
    'src/injected.js',
    'src/popup.js',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'text-summary', 'lcov', 'html'],
};