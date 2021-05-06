import run from "../src";

test("Runs Build", (done) => {
  jest.setTimeout(120000);
  process.chdir('tests/mock');
  run('build').then((code) => {
    expect(code).toBe(0);
    done();
  })
});
