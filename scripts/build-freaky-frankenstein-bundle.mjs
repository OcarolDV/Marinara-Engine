import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const FIXED_TIMESTAMP = "2026-09-09T00:00:00.000Z";
const SOURCE_FILES = {
  base: "ff54-agent-gating.marinara.json",
  final: "ff54-internal-states.st.json",
  hapuppy: "ff54-hapuppy-forced-reasoning.st.json",
  regex: "ff5-regex-3.0-suite.json",
};
const HAND_MERGED_SECTION_INDEXES = new Set([0, 40, 57, 58, 59, 60]);
const HAPUPPY_SECTION_INDEXES = new Set([0, 57, 58, 59]);
const FINAL_INDEX_OVERRIDES = new Map([
  [18, 20],
  [23, 27],
  [63, 59],
  [66, 19],
  [67, 26],
  [68, 17],
]);

function usage() {
  throw new Error("Usage: node scripts/build-freaky-frankenstein-bundle.mjs [--check] <source-directory>");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function stableId(key) {
  return crypto.createHash("sha256").update(key).digest("base64url").slice(0, 21);
}

function normalizeName(name) {
  return name.trim().replace(/\s+/g, " ");
}

function convertRollMacros(content) {
  return content.replace(/\{\{roll::(\d+d\d+)\}\}/gi, "{{roll:$1}}");
}

function outerGates(content) {
  let rest = content;
  let prefix = "";
  let count = 0;
  while (true) {
    const match = /^\{\{#if [^}]+\}\}/.exec(rest);
    if (!match) break;
    prefix += match[0];
    rest = rest.slice(match[0].length);
    count += 1;
  }
  return { prefix, suffix: "{{/if}}".repeat(count) };
}

function wrapLikeBase(content, baseContent) {
  const { prefix, suffix } = outerGates(baseContent);
  return `${prefix}${convertRollMacros(content)}${suffix}`;
}

function extractForcedReasoningBlock(content) {
  const match = /\[System Rule: You MUST structure every reply exactly like this:[\s\S]*?\]\n/.exec(content);
  assert(match, "Hapuppy source is missing the forced-reasoning block");
  return match[0];
}

function gatedForcedBlock(content) {
  return `{{#if reasoning_format == "FORCED"}}${extractForcedReasoningBlock(content)}{{/if}}\n`;
}

function mergeMainPrompt(baseContent, finalContent, hapuppyContent) {
  const baseSystemIndex = baseContent.indexOf("<system_state>");
  const finalSystemIndex = finalContent.indexOf("<system_state>");
  assert(baseSystemIndex >= 0 && finalSystemIndex >= 0, "Main Prompt is missing <system_state>");

  const basePreamble = baseContent.slice(0, baseSystemIndex);
  const baseRandomEvents = baseContent.match(/^  random events:.*$/m)?.[0];
  const finalRandomEvents = finalContent.match(/^  random events:.*$/m)?.[0];
  assert(baseRandomEvents && finalRandomEvents, "Main Prompt is missing the random-events rule");

  let sharedBody = finalContent.slice(finalSystemIndex).replace(finalRandomEvents, baseRandomEvents);
  sharedBody = sharedBody.replace("<system_state>\n", `<system_state>\n${gatedForcedBlock(hapuppyContent)}\n`);
  return convertRollMacros(`${basePreamble}${sharedBody}`);
}

function mergeDndPrompt(baseContent, finalContent) {
  const { prefix, suffix } = outerGates(baseContent);
  const agentClause = baseContent.match(/\{\{#if state_mode == "AGENTS"\}\}\nAgent Mode:[\s\S]*?\{\{\/if\}\}/)?.[0];
  assert(agentClause, "Base DnD prompt is missing its Agent Mode clause");
  const proseLine = "PROSE: Never mention rules/DC/dice stats in narrative. Embed seamlessly.";
  assert(finalContent.includes(proseLine), "Final DnD prompt is missing its PROSE line");
  const body = finalContent.replace(proseLine, `${proseLine}\n${agentClause}`);
  return `${prefix}${convertRollMacros(body)}${suffix}`;
}

function updateCotWording(baseContent, sectionIndex) {
  let content = baseContent;
  if (sectionIndex === 57) {
    content = content
      .replace("  E. DND DC Locking:", "  E. DND DC Locking (Only if `<internal_dndsim>` is active):")
      .replace("  F. DND Roll Evaluation:", "  F. DND Roll Evaluation (Only if `<internal_dndsim>` is active):")
      .replace(
        "including buffs and debuffs if present).",
        "including buffs and debuffs if present. Ignore if dndsim not active.).",
      );
  } else if (sectionIndex === 58) {
    content = content
      .replace("Reason briefly in concise bullet points", "Reason briefly in highly concise bullet points")
      .replace(
        "Permanently lock DC now.{{/if}}",
        "Permanently lock DC now. (Skip if dndsim tag not present or trivial task){{/if}}",
      )
      .replace(
        "What internal states are active, if any? I must look for XML tags",
        "What internal states are active, if any? I must update the header and look for XML tags",
      );
  } else if (sectionIndex === 59) {
    content = content
      .replace("telegraphic concise bullet points", "telegraphic highly concise bullet points")
      .replace("0. Gamestate: What is the game state?", "0. Gamestate: What is the game state?")
      .replace(
        "DND: {{getvar::dndSimCoTHQ1}}",
        "DND (skip if `<internal_dndsim>` is not active): {{getvar::dndSimCoTHQ1}}",
      )
      .replace(
        "DND Task Sim: Rolls against locked DC:",
        "DND Task Sim (skip if `<internal_dndsim>` is not active): Rolls against locked DC:",
      )
      .replace("4. Modes, Plot & State Backend:", "4. Modes, Plot & State Updates:");
  }
  return content;
}

function mergeCotPrompt(baseContent, hapuppyContent, sectionIndex) {
  let content = updateCotWording(baseContent, sectionIndex);
  const forced = gatedForcedBlock(hapuppyContent);
  const anchors = {
    57: "PHASE ALPHA:",
    58: "- A. Reason briefly",
    59: "A. Reason briefly",
  };
  const anchor = anchors[sectionIndex];
  assert(anchor && content.includes(anchor), `CoT section ${sectionIndex} is missing its Hapuppy insertion anchor`);
  content = content.replace(anchor, `${forced}\n${anchor}`);
  return convertRollMacros(content);
}

function mergePostHistory(baseContent) {
  return convertRollMacros(baseContent);
}

function findFinalPrompt(finalPrompts, baseSection, sectionIndex) {
  const override = FINAL_INDEX_OVERRIDES.get(sectionIndex);
  if (override !== undefined) return finalPrompts[override];
  const normalized = normalizeName(baseSection.name);
  return finalPrompts.find((prompt) => normalizeName(prompt.name) === normalized);
}

function buildSections(baseSections, finalPrompts, hapuppyPrompts, presetId, groupIdMap) {
  return baseSections.map((section, index) => {
    const finalPrompt = findFinalPrompt(finalPrompts, section, index);
    let content = section.content;
    if (index === 0) {
      assert(finalPrompt, "Final Main Prompt not found");
      content = mergeMainPrompt(section.content, finalPrompt.content, hapuppyPrompts[0].content);
    } else if (index === 40) {
      assert(finalPrompt, "Final DnD prompt not found");
      content = mergeDndPrompt(section.content, finalPrompt.content);
    } else if (index === 57 || index === 58 || index === 59) {
      content = mergeCotPrompt(section.content, hapuppyPrompts[index - 4].content, index);
    } else if (index === 60) {
      content = mergePostHistory(section.content);
    } else if (finalPrompt) {
      content = wrapLikeBase(finalPrompt.content ?? "", section.content);
      if (index === 68) {
        content = content
          .replace("{{Kimi-K3}}", "Kimi-K3")
          .replace("{{maxContext}}", "128000")
          .replace("{{maxResponse}}", "8192");
      }
    }

    return {
      ...section,
      id: stableId(`section:${section.name}:${index}`),
      presetId,
      groupId: section.groupId === null ? null : groupIdMap.get(section.groupId),
      content: renameLegacyToggleGates(convertRollMacros(content)),
    };
  });
}

// The macro engine's `contains` is a substring test on the joined multi-select
// value, so a toggle value that is a prefix of another (VOICE vs VOICE2,
// VNCOLOR vs VNCOLOR2) would switch both sections on. Rename the legacy values
// in the gates and the choice options together so each value is distinct.
const LEGACY_TOGGLE_VALUE_RENAMES = new Map([
  ["VOICE", "VOICE_V1"],
  ["VNCOLOR", "VNCOLOR_V1"],
]);

function renameLegacyToggleGates(content) {
  let out = content;
  for (const [from, to] of LEGACY_TOGGLE_VALUE_RENAMES) {
    out = out.replaceAll(`contains "${from}"`, `contains "${to}"`);
  }
  return out;
}

function buildGroups(baseGroups, presetId) {
  const groupIdMap = new Map();
  const groups = baseGroups.map((group, index) => {
    const id = stableId(`group:${group.name}:${index}`);
    groupIdMap.set(group.id, id);
    return {
      ...group,
      id,
      presetId,
      createdAt: FIXED_TIMESTAMP,
    };
  });
  for (const [index, group] of groups.entries()) {
    const sourceParentId = baseGroups[index].parentGroupId;
    group.parentGroupId = sourceParentId === null ? null : groupIdMap.get(sourceParentId);
  }
  return { groups, groupIdMap };
}

function regenerateChoiceBlock(block, index, presetId) {
  const options = JSON.parse(block.options).map((option, optionIndex) => {
    const renamed =
      block.variableName === "custom_toggles" && LEGACY_TOGGLE_VALUE_RENAMES.has(option.value)
        ? {
            value: LEGACY_TOGGLE_VALUE_RENAMES.get(option.value),
            label: `${option.label} (older version)`,
          }
        : {};
    return {
      ...option,
      ...renamed,
      id: `opt_${stableId(`option:${block.variableName}:${renamed.value ?? option.value}:${optionIndex}`).slice(0, 12)}`,
      ...(block.variableName === "echo_mode" && option.value === "EMBELLISH" ? { label: "🧂 Embellish Mode" } : {}),
    };
  });
  return {
    ...block,
    id: stableId(`choice:${block.variableName}:${index}`),
    presetId,
    question:
      block.variableName === "cot_style"
        ? "Chain of Thought depth. Micro is lighter, BOLT is stronger, and MAX is the deepest option."
        : block.question,
    options: JSON.stringify(options),
    createdAt: FIXED_TIMESTAMP,
  };
}

function reasoningChoiceBlock(presetId, index) {
  const options = [
    { label: "🧠 Native think tags (default)", value: "NATIVE" },
    { label: "📝 Forced Internal Monologue (Hapuppy / non-reasoning models)", value: "FORCED" },
  ].map((option, optionIndex) => ({
    id: `opt_${stableId(`option:reasoning_format:${option.value}:${optionIndex}`).slice(0, 12)}`,
    ...option,
  }));
  return {
    id: stableId(`choice:reasoning_format:${index}`),
    presetId,
    variableName: "reasoning_format",
    question:
      "Reasoning format. Forced Internal Monologue makes non-reasoning models (Hapuppy/Opus, some proxies) reason in-text; the bundled Hapuppy regex hides it.",
    options: JSON.stringify(options),
    multiSelect: "false",
    separator: ", ",
    randomPick: "false",
    displayMode: "buttons",
    optionSort: "manual",
    sortOrder: 1200,
    createdAt: FIXED_TIMESTAMP,
  };
}

function buildPreset(base, universal) {
  const presetId = stableId("preset:freaky-frankenstein-5.4");
  const { groups, groupIdMap } = buildGroups(base.data.groups, presetId);
  const sections = buildSections(
    base.data.sections,
    universal.sources.final.prompts,
    universal.sources.hapuppy.prompts,
    presetId,
    groupIdMap,
  );
  const choiceBlocks = base.data.choiceBlocks.map((block, index) => regenerateChoiceBlock(block, index, presetId));
  choiceBlocks.push(reasoningChoiceBlock(presetId, choiceBlocks.length));

  const defaultChoices = {
    cot_style: "BOLT",
    pov_style: "HYBRID",
    prose_style: "CINEMA",
    output_length: "ON",
    echo_mode: "ANTIPARROT",
    nsfw_mode: "FREAKY",
    state_mode: "INTERNAL",
    internal_states: ["DND", "AGENDA", "NOTEBOOK", "INVENTORY", "BONDS", "THOUGHTS"],
    custom_toggles: ["VOICE2", "ANTIOMNI", "VAD", "REALNPC", "BANNED", "VNCOLOR2", "POPGFX", "COMBAT", "GENESIS"],
    bypass_mode: "FULL",
    extras: [],
    reasoning_format: "NATIVE",
  };

  const preset = {
    ...base.data.preset,
    id: presetId,
    name: "Freaky Frankenstein 5.4",
    author: "dptgreg, leovarian, ok_strategy_2420",
    description:
      "Freaky Frankenstein 5.4: Internal States — dptgreg's community roleplay preset (co-authored with leovarian and ok_strategy_2420), converted to Marinara by Pinkcone23. Bundles the FF5 Regex 3.0 suite. Pick prose, POV, NSFW mode, Chain-of-Thought depth and Internal States or Agents from the preset variables. https://rentry.org/freaky-frankenstein-presets",
    systemKey: "freaky-frankenstein-preset",
    isDefault: "false",
    wrapFormat: "none",
    imagePath: null,
    conversationPrompt: "",
    gamePrompt: "",
    variableGroups: "[]",
    variableValues: "{}",
    parameters: universal.parameters,
    defaultChoices: JSON.stringify(defaultChoices),
    sectionOrder: JSON.stringify(sections.map((section) => section.id)),
    groupOrder: JSON.stringify(groups.map((group) => group.id)),
    createdAt: FIXED_TIMESTAMP,
    updatedAt: FIXED_TIMESTAMP,
  };

  return {
    type: "marinara_preset",
    version: 1,
    exportedAt: FIXED_TIMESTAMP,
    source: {
      reddit:
        "https://www.reddit.com/r/SillyTavernAI/comments/1w49lyx/preset_update_freaky_frankenstein_54_the_second/",
      rentry: "https://rentry.org/freaky-frankenstein-presets",
      mediafire: {
        internalStates:
          "https://www.mediafire.com/file/9f70q840092j5lr/Freaky_Frankenstein_5.4_Internal_States_%25282%2529.json/file",
        hapuppyForcedReasoning:
          "https://www.mediafire.com/file/b351li1ugeuiric/Freaky_Frankenstein_5.4_Hapuppy_Forced_Reasoning_%25281%2529.json/file",
        regexSuite: "https://www.mediafire.com/file/4gnj5fvd1opfm96/FF5_Regex_3.0_Suite.json/file",
        marinaraAgentGating:
          "https://www.mediafire.com/file/0wxpydn1i4cj0vw/Freaky_Frankenstein_5.4_%25E2%2580%2594_Agent_Gating.marinara.json/file",
      },
      version: "5.4",
      releasedAt: "2026-09-01",
      marinaraConversionBy: "Pinkcone23",
      regenerate: "Run node scripts/build-freaky-frankenstein-bundle.mjs <source-directory>.",
    },
    data: { preset, sections, groups, choiceBlocks },
  };
}

function readBooleanFlag(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function convertRegexSuite(scripts) {
  return scripts.map((script, index) => {
    const rawFind = typeof script.findRegex === "string" ? script.findRegex.trim() : "";
    assert(rawFind, `Regex row ${index} has no findRegex`);
    const delimited = /^\/(.*)\/([a-z]*)$/is.exec(rawFind);
    const source = delimited ? delimited[1] : rawFind;
    const flags = Array.from(new Set((delimited?.[2] ?? "").replace(/[^gimsuy]/g, ""))).join("");
    new RegExp(source, flags);

    const placement = [];
    const sourcePlacement = Array.isArray(script.placement) ? script.placement : [2];
    for (const value of sourcePlacement) {
      if (value === 1 && !placement.includes("user_input")) placement.push("user_input");
      else if (value === 2 && !placement.includes("ai_output")) placement.push("ai_output");
    }
    assert(placement.length > 0, `Regex row ${index} has no supported placement`);

    const promptOnly = readBooleanFlag(script.promptOnly);
    const markdownOnly = readBooleanFlag(script.markdownOnly);
    const applyMode = promptOnly && !markdownOnly ? "prompt" : markdownOnly && !promptOnly ? "display" : "both";
    const slug = script.scriptName
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .replace(/^ff5-/, "");

    return {
      id: `ff5-regex-${slug}`,
      name: script.scriptName.trim(),
      enabled: script.disabled !== true,
      findRegex: source,
      replaceString: typeof script.replaceString === "string" ? script.replaceString : "",
      trimStrings: Array.isArray(script.trimStrings)
        ? script.trimStrings.filter((value) => typeof value === "string")
        : [],
      placement,
      flags,
      promptOnly: applyMode === "prompt",
      applyMode,
      targetCharacterIds: [],
      targetPromptPresetIds: [],
      order: -1000 + index * 10,
      minDepth: typeof script.minDepth === "number" ? script.minDepth : null,
      maxDepth: typeof script.maxDepth === "number" ? script.maxDepth : null,
      createdAt: FIXED_TIMESTAMP,
      updatedAt: FIXED_TIMESTAMP,
    };
  });
}

function jsonText(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function loadSources(sourceDirectory) {
  for (const file of Object.values(SOURCE_FILES)) {
    assert(fs.existsSync(path.join(sourceDirectory, file)), `Missing source file: ${file}`);
  }
  return {
    base: readJson(path.join(sourceDirectory, SOURCE_FILES.base)),
    final: readJson(path.join(sourceDirectory, SOURCE_FILES.final)),
    hapuppy: readJson(path.join(sourceDirectory, SOURCE_FILES.hapuppy)),
    regex: readJson(path.join(sourceDirectory, SOURCE_FILES.regex)),
  };
}

function assertUniqueExact(actual, expected, label) {
  assert.equal(actual.length, expected.length, `${label} has the wrong count`);
  assert.equal(new Set(actual).size, actual.length, `${label} contains duplicates`);
  assert.deepEqual(new Set(actual), new Set(expected), `${label} does not contain exactly the expected IDs`);
}

async function verify(bundle, regexRows, sourceData) {
  assert.equal(bundle.type, "marinara_preset");
  assert.equal(bundle.version, 1);
  assert.equal(bundle.data.sections.length, 69);
  assert.equal(bundle.data.groups.length, 12);
  assert.equal(bundle.data.choiceBlocks.length, 12);
  assert.equal(regexRows.length, 25);

  const groupIds = bundle.data.groups.map((group) => group.id);
  const sectionIds = bundle.data.sections.map((section) => section.id);
  for (const section of bundle.data.sections) {
    assert(
      section.groupId === null || groupIds.includes(section.groupId),
      `Section ${section.name} has an unresolved groupId`,
    );
    assert.equal(section.presetId, bundle.data.preset.id);
  }
  assertUniqueExact(JSON.parse(bundle.data.preset.sectionOrder), sectionIds, "sectionOrder");
  assertUniqueExact(JSON.parse(bundle.data.preset.groupOrder), groupIds, "groupOrder");

  // `contains` is a substring test on the joined selection, so no option value
  // may be a substring of a sibling value, and every gate must name a real value.
  const optionValuesByVariable = new Map();
  for (const block of bundle.data.choiceBlocks) {
    const values = JSON.parse(block.options).map((option) => option.value);
    optionValuesByVariable.set(block.variableName, values);
    for (const a of values) {
      for (const b of values) {
        assert(a === b || !b.includes(a), `${block.variableName}: option value ${a} is a substring of ${b}`);
      }
    }
  }
  for (const section of bundle.data.sections) {
    for (const match of section.content.matchAll(/(\w+) contains "([^"]+)"/g)) {
      const values = optionValuesByVariable.get(match[1]);
      assert(values, `${section.name}: gate references unknown variable ${match[1]}`);
      assert(values.includes(match[2]), `${section.name}: gate references unknown value ${match[1]}=${match[2]}`);
    }
  }

  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const sharedEntry = path.join(repoRoot, "packages", "shared", "dist", "index.js");
  assert(fs.existsSync(sharedEntry), "Shared build missing; run pnpm build:shared first");
  const { isPatternSafe, resolveMacros } = await import(pathToFileURL(sharedEntry).href);

  console.log("\nRegex safety");
  for (const row of regexRows) {
    new RegExp(row.findRegex, row.flags);
    const safe = isPatternSafe(row.findRegex);
    console.log(`${safe ? "PASS" : "FAIL"}\t${row.id}\t${row.name}`);
  }

  const defaults = JSON.parse(bundle.data.preset.defaultChoices);
  const variables = Object.fromEntries(
    Object.entries(defaults).map(([key, value]) => [key, Array.isArray(value) ? value.join(", ") : String(value)]),
  );
  const context = {
    user: "Alex",
    char: "Mira",
    characters: ["Mira"],
    variables,
    localVariables: variables,
    agentData: {},
  };
  const forbidden = ["{{#if", "{{/if}}", "{{else", "{{roll::", "{{maxContext}}", "{{maxResponse}}", "{{char}}"];

  console.log("\nDefault macro render lengths");
  console.log("idx\tlength\tname");
  for (const [index, section] of bundle.data.sections.entries()) {
    if (section.enabled !== "true") continue;
    const rendered = resolveMacros(section.content, context);
    for (const token of forbidden) {
      assert(!rendered.includes(token), `${section.name} left ${token} in rendered output`);
    }
    const gates = outerGates(section.content);
    if (gates.prefix) {
      const probe = resolveMacros(`${gates.prefix}ON${gates.suffix}`, {
        ...context,
        variables: { ...variables },
        localVariables: { ...variables },
      });
      if (!probe.includes("ON")) assert.equal(rendered.trim(), "", `${section.name} should be gated off by defaults`);
    }
    console.log(`${index}\t${rendered.length}\t${section.name}`);
  }

  for (const [sectionIndex, cotStyle] of [
    [0, "BOLT"],
    [57, "MAX"],
    [58, "BOLT"],
    [59, "MICRO"],
  ]) {
    const section = bundle.data.sections[sectionIndex];
    const renderWith = (reasoningFormat) =>
      resolveMacros(section.content, {
        ...context,
        variables: { ...variables, cot_style: cotStyle, reasoning_format: reasoningFormat },
        localVariables: { ...variables, cot_style: cotStyle, reasoning_format: reasoningFormat },
      });
    assert(!renderWith("NATIVE").includes("### Internal Monologue"), `${section.name}: Hapuppy block leaked in NATIVE`);
    assert(renderWith("FORCED").includes("### Internal Monologue"), `${section.name}: Hapuppy block missing in FORCED`);
  }

  console.log("\nSection source comparison (outer gates stripped; converted roll syntax expected)");
  for (const [index, section] of bundle.data.sections.entries()) {
    const finalPrompt = findFinalPrompt(sourceData.final.prompts, sourceData.base.data.sections[index], index);
    if (!finalPrompt) {
      console.log(`${index}\tN/A\t${section.name}\tbase-only section`);
      continue;
    }
    if (HAND_MERGED_SECTION_INDEXES.has(index) || HAPUPPY_SECTION_INDEXES.has(index) || index === 68) {
      const reason = index === 68 ? "Kimi literal substitutions" : "hand-merged structure/forced-reasoning gate";
      console.log(`${index}\tfalse\t${section.name}\t${reason}`);
      continue;
    }
    const { prefix, suffix } = outerGates(section.content);
    const body = section.content.slice(prefix.length, suffix ? -suffix.length : undefined);
    const same = body === convertRollMacros(finalPrompt.content ?? "");
    assert(same, `${section.name} drifted from the final ST text`);
    console.log(`${index}\ttrue\t${section.name}`);
  }
}

const check = process.argv.includes("--check");
const positional = process.argv.slice(2).filter((arg) => arg !== "--check");
if (positional.length !== 1) usage();
const sourceDirectory = path.resolve(positional[0]);
const sources = loadSources(sourceDirectory);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultPreset = readJson(path.join(repoRoot, "packages", "server", "src", "db", "default-preset.json"));
const bundle = buildPreset(sources.base, {
  parameters: defaultPreset.data.preset.parameters,
  sources,
});
const regexRows = convertRegexSuite(sources.regex);
const outputs = [
  [path.join(repoRoot, "packages", "server", "src", "db", "freaky-frankenstein-preset.json"), jsonText(bundle)],
  [path.join(repoRoot, "packages", "server", "src", "db", "freaky-frankenstein-regex.json"), jsonText(regexRows)],
];

if (check) {
  for (const [outputPath, expected] of outputs) {
    assert(fs.existsSync(outputPath), `Generated output is missing: ${outputPath}`);
    assert.equal(fs.readFileSync(outputPath, "utf8"), expected, `${outputPath} is stale; regenerate it`);
  }
  await verify(bundle, regexRows, sources);
  console.log("\nFreaky Frankenstein bundle check passed.");
} else {
  for (const [outputPath, contents] of outputs) fs.writeFileSync(outputPath, contents, "utf8");
  console.log(`Wrote ${outputs[0][0]}`);
  console.log(`Wrote ${outputs[1][0]}`);
}
