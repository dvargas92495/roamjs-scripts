import { cy as imported, describe, it, Cypress, expect } from "local-cypress";
import "cypress-plugin-tab";

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
      cy.get(".loading-astrolabe");
      cy.get(".loading-astrolabe", { timeout: 60000 }).should("not.exist");
      cy.location().then((loc) => {
        if (loc.hash.endsWith("app")) {
          // already logged in, good to keep going
        } else if (loc.hash.endsWith("signin")) {
          cy.visit("/#/signin");
          cy.get("[name=email]").type(Cypress.env("ROAM_USERNAME"));
          cy.get("[name=password]").type(Cypress.env("ROAM_PASSWORD"));
          cy.get(".bp3-button").first().click();
        } else {
          expect(loc.hash).to.match(/(app|signin)/);
        }
      });
      cy.get(".my-graphs", { timeout: 60000 });
      const graph = "testing-graph";
      cy.visit(`#/offline/${graph}`);
      cy.get(".loading-astrolabe");
      cy.get(".loading-astrolabe", { timeout: 60000 }).should("not.exist");
      localStorage.setItem(`roamjs:experimental:${graph}`, "true");
      cy.get(".roam-block").first().click();
      cy.get("textarea.rm-block-input")
        .clear()
        .type("{{}{{}[[roam/js]]}}{enter}");
      cy.get("textarea.rm-block-input").tab().wait(1000);
      cy.get("textarea.rm-block-input").click().type(`\`\`\``);
      cy.get(".cm-content").first().click()
        .type(`var existing = document.getElementById("roamjs-${Cypress.env(
        "ROAMJS_EXTENSION_ID"
      )}-main");
if (!existing) {{}
  var extension = document.createElement("script");
  extension.src = "http://localhost:8000/main.js"
  extension.id = "roamjs-${Cypress.env("ROAMJS_EXTENSION_ID")}-main";
  extension.async = true;
  extension.type = "text/javascript";
  document.getElementsByTagName("head")[0].appendChild(extension);`); // dont enter closing brace, autocomplete adds it for us
      cy.get(".rm-code-warning .bp3-button").click();

      test({ cy, Cypress, done });

      // delete graph
    });
  });
};

export default runE2eTest;
