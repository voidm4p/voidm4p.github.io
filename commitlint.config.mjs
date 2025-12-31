export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // keep body lines unbounded to match existing package.json config
    'body-max-line-length': [0, 'always']
  }
};
