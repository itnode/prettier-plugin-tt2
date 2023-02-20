<script lang="ts">
  import prettier from "prettier/standalone";
  import pluginHtml from "prettier/parser-html";
  import pluginBabel from "prettier/parser-babel";
  import pluginCSS from "prettier/parser-postcss";
  import * as pluginTT2Template from "prettier-plugin-tt2";

  let input = `[% IF test %]
<p>Test [% GET test %]</p>
[% END %]
`;
  $: output = getFormattedInput(input);

  function getFormattedInput(text: string): string {
    try {
      return prettier.format(text, {
        parser: "tt2",
        plugins: [pluginHtml, pluginBabel, pluginCSS, pluginTT2Template],
      });
    } catch (e) {
      return e.toString();
    }
  }
</script>

<main>
  <textarea bind:value={input} />
  <div class="divider" />
  <textarea bind:value={output} class="output-only" disabled />
</main>

<style>
  .output-only {
    pointer-events: none;
  }
  .divider {
    width: 1px;
    background-color: darkgray;
  }
  textarea {
    outline: none;
    border-radius: 0;
    flex-grow: 1;
    font-family: monospace;
    white-space: pre-wrap;
  }
  main {
    display: flex;
    justify-items: stretch;
    height: 100%;
    width: 100%;
  }
</style>
