import { defineConfig } from "cypress";

export default defineConfig({
  e2e: {
    setupNodeEvents(on) {
      on("after:run", (results) => {
        console.log(results);
      });
    },
  },
});
