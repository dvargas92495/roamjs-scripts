import run from "../src";

test("Runs Build", (done) => {
  jest.setTimeout(60000);
  run('build').then((code) => {
    expect(code).toBe(0);
    done();
  })
});
