import run from "../src";

test("Runs Build", (done) => {
  run('build').then((code) => {
    expect(code).toBe(0);
    done();
  })
});
