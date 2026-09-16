module.exports = {
  preset: '@react-native/jest-preset',
  testMatch: ['**/__tests__/**/*.test.ts?(x)'],
  transformIgnorePatterns: ['node_modules/(?!(react-native|@react-native|@react-navigation|react-native-.*|uuid)/)'],
};
