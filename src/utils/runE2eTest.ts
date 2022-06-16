import { cy as imported, describe, it, Cypress } from "local-cypress";

const runE2eTest = (
  title: string,
  test: (args: {
    cy: Cypress.cy;
    Cypress: Cypress.Cypress;
    done: Mocha.Func;
  }) => void
): void => {
  const cy = imported as Cypress.cy;
  describe(title, () => {
    it(`Running Test: ${title}`, (done) => {
      cy.visit("#/signin");
      cy.get("[name=email]").type(Cypress.env("ROAM_USERNAME"));
      cy.get("[name=password]").type(Cypress.env("ROAM_PASSWORD"));
      cy.get(".bp3-button").first().click();
      cy.get(".my-graphs");
      cy.visit("#/offline/testing-graph");
      cy.get(".roam-block").click();
      cy.type("{{[[roam/js]]}}{enter}");
      const installation = `var existing = document.getElementById("roamjs-${Cypress.env(
        "ROAMJS_EXTENSION_ID"
      )}-main");
if (!existing) {
  var extension = document.createElement("script");
  extension.src = "http://localhost:8000/main.js"
  extension.id = "roamjs-${Cypress.env("ROAMJS_EXTENSION_ID")}-main";
  extension.async = true;
  extension.type = "text/javascript";
  document.getElementsByTagName("head")[0].appendChild(extension);
}`;
      cy.type(`{tab}\`\`\`javascript\n${installation}\`\`\``);
      cy.get(".rm-code-warning .bp3-button").click();

      test({cy, Cypress, done});

      // delete graph
    });
  });
};

export default runE2eTest;
