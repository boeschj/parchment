import {
  RoutePreset,
  RouteStage,
  RouteStrategy,
  VisualRoute,
  type RouteCandidate,
  type RouteDecision,
  type RouteEvidence,
  type RouteInput,
  type RoutePreset as RoutePresetType,
  type VisualRoute as VisualRouteType,
} from "./types.ts";

type MutableCandidate = RouteCandidate & {
  strongestMetadataWeight: number;
};

type CandidateMetadata = {
  strategy?: RouteStrategy;
  preset?: RoutePresetType;
  viewer?: string;
};

const ROUTE_TIE_BREAK: readonly VisualRouteType[] = [
  VisualRoute.McpApp,
  VisualRoute.File,
  VisualRoute.WebPreview,
  VisualRoute.Html,
  VisualRoute.Mermaid,
  VisualRoute.Component,
  VisualRoute.Markdown,
  VisualRoute.Transcript,
];

const ROUTE_STRATEGY: Record<VisualRouteType, RouteStrategy> = {
  [VisualRoute.Transcript]: RouteStrategy.None,
  [VisualRoute.Markdown]: RouteStrategy.Reuse,
  [VisualRoute.Mermaid]: RouteStrategy.Reuse,
  [VisualRoute.File]: RouteStrategy.Reuse,
  [VisualRoute.McpApp]: RouteStrategy.Mount,
  [VisualRoute.Component]: RouteStrategy.Compose,
  [VisualRoute.Html]: RouteStrategy.Generate,
  [VisualRoute.WebPreview]: RouteStrategy.Preview,
};

const PRESENTATION_VERB = /\b(?:show|give|make|create|render|present|turn|visuali[sz]e|draw|map|display|open|view|summari[sz]e|explain|walk\s+me\s+through|lay\s+out)\b/i;
const IMPLEMENTATION_TASK = /\b(?:implement|fix|debug|refactor|replace|migrate|add\s+support|write\s+(?:the\s+)?(?:code|function|class|test)|update\s+(?:the\s+)?(?:code|repo|implementation)|modify\s+(?:the\s+)?(?:code|repo)|install|upgrade|rename|delete)\b/i;
const REPO_TARGET = /(?:\b(?:repo(?:sitory)?|codebase|implementation|tests?|dependency|package)\b|(?:^|[\s`'"(])(?:\.?\.?\/)?[\w.-]+\/(?:[\w./-]+)|\b[\w.-]+\.(?:ts|tsx|js|jsx|py|go|rs|java|rb|css|scss)\b)/i;
const IMPLEMENTATION_RESULT_PRESENTATION = /(?:\b(?:then|after(?:ward)?|and)\s+(?:show|preview|render|open|display|present|visuali[sz]e|draw|map)\b|\b(?:show|preview|render|open|display|present|visuali[sz]e|draw|map)\b[\s\S]{0,80}\b(?:result|output|changes?|app|site|page|ui|preview|diagram|flow|architecture|diff|dashboard)\b)/i;
const IMPLEMENTATION_FILE_PRESENTATION = /\b(?:show|open|display|view|inspect|preview|render)\b[\s\S]{0,80}\b(?:file|source|code|diff|patch|changes?)\b/i;
const FORMAT_META_CONTEXT = /\b(?:quoted\s+(?:word|term|label)s?|(?:category|field)\s+labels?|merely\s+(?:field\s+)?labels?|output[- ]format\s+(?:word|term|label)s?|words?\b[\s\S]{0,80}\b(?:name|mean|languages?|rendering\s+formats?)\b|what\s+does\b[\s\S]{0,60}\b(?:mean|syntax)\b|inside\s+(?:mermaid|markdown|html)\b[\s\S]{0,40}\bsyntax\b|word\s+[‘'"“]|term\s+[‘'"“]|name\s+[‘'"“]|why\s+(?:is|was)\s+(?:the\s+)?(?:name|term)|why\s+(?:the\s+)?(?:name|term)\b[\s\S]{0,40}\b(?:was|is)|meaning\s+of\s+(?:the\s+)?(?:word|term|name)|etymology|pronunciation|not\s+(?:a\s+|the\s+)?requested\s+output\s+formats?)\b/i;
const DEFINITION_META_CONTEXT = /\b(?:define|definition\s+of|what\s+(?:is|are))\b[\s\S]{0,80}\b(?:web\s+preview|markdown|mermaid|html|dashboard|component|file\s+viewer)\b/i;
const VISUAL_NEGATION = /\b(?:(?:do\s+not|don't|dont|no|without|skip|avoid)\s+(?:the\s+)?(?:canvas|visuals?|visualization|ui|artifact)|(?:do\s+not|don't|dont|never|avoid|skip)\b[^.!?;\n]{0,60}\b(?:artifacts?|visual\s+outputs?|visuals?|canvas|ui)\b|plain\s+text\s+only|text\s+only|terminal\s+only|strict\s+json\s+only|json\s+only|return\s+only\s+json|just\s+answer\s+(?:here|in\s+the\s+terminal)|just\s+(?:give|show|tell)\s+me\s+(?:the\s+)?(?:command|answer|path|name)|reply\s+(?:with\s+)?[‘'\"]?done[’'\"]?)\b/i;
const EXPLICIT_VISUAL_REJECTION = /\b(?:not\s+(?:an?\s+)?(?:diagram|visual|visualization)|only\s+want\b[\s\S]{0,80}\bnot\s+(?:an?\s+)?(?:diagram|visual|visualization))\b/i;
const ANSWER_ONLY_CONTEXT = /\b(?:this\s+is\s+)?just\s+an?\s+answer\b|\bnot\s+(?:a\s+)?reusable\s+document\s+or\s+ui\b/i;
const MINIMAL_ANSWER_ONLY = /\b(?:reply\s+with|return|give\s+me)\b[\s\S]{0,80}\b(?:(?:the\s+)?(?:person(?:'s|’s)?\s+)?name|(?:the\s+)?(?:file\s*name|filename|file\s+path|path|number|count))\s+only\b|\breturn\s+only\s+(?:the\s+)?(?:file\s*name|filename|file\s+path|path|number|count|name)\b/i;
const NON_FULFILLMENT_RESPONSE = /\b(?:i[’']?ll|i\s+will|i\s+can)\b[\s\S]{0,180}\b(?:next|later|after|when|once|in\s+the\s+next\s+step)\b|\bno\s+(?:live\s+)?(?:url|running\s+surface|preview|artifact|file|component)\b[\s\S]{0,80}\b(?:available|exists?|ready)\b[\s\S]{0,30}\byet\b/i;
const MARKDOWN_EXPLICIT = /\b(?:(?:as|in|to|using|raw|structured)\s+markdown|(?:already|existing)\s+markdown|markdown\s+(?:notes?|report|document|file|brief|table|output|content|artifact|structure|manual|handbook|syllabus|curriculum|charter|glossary))\b/i;
const DECK_EXPLICIT = /\b(?:slides?|slide\s+deck|presentation|pitch\s+deck|keynote)\b/i;
const HTML_EXPLICIT = /\b(?:raw\s+html|single[- ]file\s+html|self[- ]contained(?:\s+[\w-]+){0,3}\s+html|(?:new|fresh|standalone|bespoke|custom)(?:\s+[\w-]+){0,3}\s+html(?:\s*[/,]\s*css\s*[/,]\s*(?:js|javascript))?|html\s+canvas|html\s*[,/]\s*css\s*(?:(?:[,/]\s*)|(?:and\s+))(?:js|javascript)|html\s+(?:page|artifact|file|prototype|deck|presentation|experience|explainer|journey|microsite|art\s+piece|museum\s+exhibit|installation|cutaway)|as\s+html|in\s+html)\b/i;
const MERMAID_EXPLICIT = /\b(?:mermaid|flow\s*chart|sequence\s+diagram|request\s+sequence\s+(?:among|between)|state[- ]machine(?:\s+diagram)?|state\s+diagram|state\s+transitions?|mind\s*map|architecture\s+(?:diagram|graph)|dependency\s+(?:graph|topology)|entity[- ]relationships?(?:\s+diagram)?|er\s+diagram|foreign[- ]key\s+relationships?|editable\s+diagram|(?:service|system|branching)\s+topology|topology\s+(?:of|from)|labeled\s+(?:data\s+)?flows?)\b/i;
const GRAPH_INTENT = /\b(?:map|make|create|diagram|draw|display|show|visuali[sz]e|turn\b[\s\S]{0,60}\binto)\b/i;
const GRAPH_STRUCTURE = /\b(?:graphs?|topolog(?:y|ies)|dependencies|dependency|sequences?|decision\s+trees?|nodes?|edges?|fan(?:s|ning)?\s+(?:in|into|out)|branches?|branching|convergence|(?:directed|entity)\s+relationships?|cardinalit(?:y|ies))\b/i;
const NEGATED_DIAGRAM = /\b(?:(?:do\s+not|don't|dont|no|without|avoid|skip)\s+(?:(?:render|draw|show|create)\s+)?(?:a\s+|the\s+|any\s+)?(?:diagram|mermaid|graph|flow\s*chart))\b/i;
const PREVIEW_EXPLICIT = /\b(?:(?:open|show|launch|view)\b[\s\S]{0,40}\bpreview|(?:open|show|launch|preview|view|run)\s+(?:me\s+)?(?:the\s+)?(?:app|site|website|page|localhost|preview)|(?:start|run|launch)\s+(?:the\s+)?existing\s+app|live\s+(?:working\s+)?preview|clickable\s+preview|browser\s+preview|web\s+preview|rendered\s+preview|visual\s+(?:before\s*\/\s*after\s+)?(?:diff|preview))\b/i;
const RUNNING_APP_PREVIEW = /(?:\b(?:preview|open|show|view|launch|inspect|present|render)\b[\s\S]{0,80}\b(?:existing|running|current|served)\b[\s\S]{0,60}\b(?:app|site|website|portal|dashboard|build)\b|\b(?:existing|running|current|served)\b[\s\S]{0,60}\b(?:app|site|website|portal|dashboard|build)\b[\s\S]{0,60}\b(?:browser|preview|interactive\s+browser\s+surface)\b)/i;
const WEB_SURFACE_INTENT = /\b(?:preview|open|show|view|launch|inspect|present|display|render|take\s+me\s+to)\b[\s\S]{0,100}\b(?:existing|running|current|served|local|production|deployed)\b[\s\S]{0,80}\b(?:apps?|sites?|websites?|portals?|dashboards?|builds?|pages?|web\s+surfaces?)\b/i;
const COMPONENT_EXPLICIT = /\b(?:dashboard|control\s+panel|interactive\s+(?:[\w-]+\s+){0,3}(?:form|panel|explorer|calculator|simulator|timeline|comparison|report|checklist)|(?:searchable|sortable|filterable)(?:,\s*(?:searchable|sortable|filterable))*\s+(?:table|list|view)|form\s+for\s+(?:choosing|selecting|toggling|editing)|configurator|decision\s+matrix)\b/i;
const NEGATED_COMPONENT = /\b(?:(?:no|without|avoid|skip)\s+(?:an?\s+|the\s+|any\s+)?(?:standard\s+)?(?:(?:interactive\s+)?dashboard|control\s+panel|interactive\s+ui|components?|charts?|tables?)|(?:do\s+not|don't|dont)\s+(?:build|make|create|use|show|render)\s+(?:an?\s+|the\s+|any\s+)?(?:(?:interactive\s+)?dashboard|control\s+panel|interactive\s+ui|components?|charts?|tables?)|(?:do\s+not|don't|dont)[^.!?;\n]{0,60}\bor\s+(?:build|make|create|use|show|render)\s+(?:an?\s+|the\s+|any\s+)?(?:(?:interactive\s+)?dashboard|control\s+panel|interactive\s+ui|components?|charts?|tables?))\b/i;
const NEGATED_BESPOKE_EXPERIENCE = /\b(?:no|without|avoid|skip|do\s+not|don't|dont)\b[^.!?;\n]{0,80}\b(?:bespoke|custom)\b[^.!?;\n]{0,50}\b(?:animation|motion|art\s+direction|visuals?|rendering)\b|\b(?:no|without|avoid|skip|do\s+not|don't|dont)\b[^.!?;\n]{0,80}\bart\s+direction\b/i;
const STANDARD_UI_AFFORDANCE = /\b(?:filterable|sortable|sorting|searchable|expandable|editable|draggable|resizing|search\s+(?:box|field)|drop-?downs?|select\s+menus?|filters?|filter\s+bars?|sort\s+menus?|chips?|reset\s+buttons?|sliders?|toggles?|switches?|checkboxes?|radio\s+(?:button\s+)?groups?|radio\s+buttons?|tabs?|buttons?|save\s+or\s+cancel\s+controls?)\b/gi;
const STANDARD_UI_SURFACE = /\b(?:ui|explorer|tool|catalog|view|table|grid|list|rows?|details?|controls?|form|panel|cards?|components?|combobox|dropzone|dialogs?|pagination)\b/i;
const UI_CREATION_REQUEST = /(?:^|[.;]\s*)(?:please\s+)?(?:build|make|create|compose|present|show|put|turn|give\s+me)\b/i;
const STANDARD_CONTROLS_REQUEST = /\buse\s+standard\b[\s\S]{0,100}\b(?:controls?|tabs?|checkboxes?|sliders?|filters?|tables?|timelines?)\b/i;
const REUSABLE_UI_REQUEST = /\b(?:let\s+me\s+interact\s+with|show|present|give\s+me|create|make|build)\b[\s\S]{0,140}\b(?:reusable|interactive|live)\b[\s\S]{0,80}\b(?:date[- ]range\s+picker|picker|calculator|data[- ](?:table|grid)|stepper|sliders?|component|controls?|form|panel)\b/i;
const COMPONENT_ARTIFACT_REQUEST = /\b(?:build|create|make|show|present)\b[\s\S]{0,100}\b(?:date[- ]range\s+filter|tabs?|controls?|picker|calculator|stepper)\s+component\b/i;
const STANDARD_UI_NOUN_REQUEST = /\b(?:build|create|make|show|present|give\s+me)\b[\s\S]{0,120}\b(?:date[- ]range\s+picker|settings\s+panel|data\s+grid|interactive\s+slider|filter\s+bar|standard\s+inputs?)\b/i;
const STANDARD_COMPONENT_REQUEST = /\b(?:build|create|make|show|present|give\s+me)\b[\s\S]{0,140}\b(?:searchable\s+combobox|file[- ]upload\s+dropzone|confirmation\s+dialog|pagination\s+control)\b/i;
const STANDARD_FORM_REQUEST = /\b(?:build|create|make|show|present|give\s+me)\b[\s\S]{0,100}\b(?:[\w-]+\s+){0,3}form\b[\s\S]{0,180}\b(?:fields?|select|notes?\s+area|validation|warning\s+banner|approve|reject|submit)\b/i;
const STANDARD_CARD_COMPOSITION = /\b(?:arrange|organize|present|show|put)\b[\s\S]{0,160}\b(?:status\s+)?cards?\b[\s\S]{0,140}\b(?:filters?|controls?|badges?|pause|resume)\b/i;
const INTERACTIVE_TABLE_REQUEST = /\b(?:interactive|sortable|filterable|searchable)\b[\s\S]{0,100}\b(?:comparison\s+)?table\b|\btable\b[\s\S]{0,140}\b(?:sortable\s+columns?|tabs?|filters?|select[- ]?plan\s+buttons?)\b/i;
const CROSS_SOURCE_UI = /\b(?:cross[- ]source|(?:two|three|four|five|\d+)\s+sources?|source\s+summaries)\b[\s\S]{0,160}\b(?:explorer|matrix|view|dashboard|table|tabs?|filters?|panel|card|component)\b/i;
const COMPOSE_EXPLICIT = /\b(?:combine|compose|stitch|unify|bring\s+together|across)\b[\s\S]{0,160}\b(?:connected\s+|single\s+|operational\s+)?(?:view|report|dashboard|board|panel|card|explorer|matrix|component|summary|table|grid)\b/i;
const NATIVE_APP_NEGATION = /\b(?:(?:do\s+not|don't|dont)\s+(?:open|use|show|mount)\s+(?:either\s+)?(?:the\s+)?(?:source(?:'s|’s)\s+)?(?:(?:native|server[- ]owned)\s+)?(?:apps?|uis?)|not\s+(?:its|the|their)\s+(?:native\s+)?(?:apps?|uis?))\b/i;
const BESPOKE_HTML = /\b(?:standalone\s+(?:simulator|playground|experience|visual)|(?:bespoke|custom)(?:\s+[\w-]+){0,3}\s+(?:microsite|browser\s+experience|interactive\s+(?:story|explainer))|(?:full[- ]screen\s+)?museum\s+(?:kiosk|exhibit)(?:\s+experience)?|(?:single[- ]page\s+)?microsite\b[\s\S]{0,60}\bfrom\s+scratch|scroll[- ]driven\s+(?:web\s+story|timeline)|(?:from[- ]scratch\s+)?full[- ]screen\s+(?:product\s+)?tour|browser[- ]based\s+(?:(?:product|museum)\s+)?(?:tour|kiosk)|product\s+tour\b[\s\S]{0,80}\b(?:morphs?|morphing|custom\s+illustrations?)|webgl|shader|fragment[- ]canvas|canvas\s+animation|animated\s+cutaway\s+scenes?|pixel[- ]faithful|full[- ]bleed|full[- ]screen\s+(?:data\s+)?story|timed\s+reveals?|draggable|animated\s+(?:rotations?|transitions?|simulation|route)|bespoke\s+(?:canvas\s+)?animation|custom\s+(?:scroll\s+)?animation|scrollytelling|parallax|as\s+(?:the\s+)?reader\s+scrolls?|pinned\s+chapters?|custom\s+ending\s+sequence|spring\s+physics|pointer[- ]driven\s+(?:motion|turbulence)|art[- ]directed|brand(?:ed)?\s+typography)\b/i;
const BESPOKE_PAGE_REQUEST = /\b(?:design|create|make|prototype|build)\b[\s\S]{0,160}\b(?:one[- ]off\s+(?:launch\s+)?page|original\s+(?:mission[- ]control\s+)?wall|fictional\s+[\w-]+\s+(?:experience|page|wall))\b[\s\S]{0,180}\b(?:custom\s+motion|unusual\s+editorial\s+layout|layered\s+[\w-]+\s+visuals?|cinematic\s+transitions?)\b/i;
const NATIVE_FILE_DELIVERABLE = /\b(?:create|generate|make|produce|export|deliver|give\s+me)\b[\s\S]{0,120}?\b(?:a\s+|an\s+)?(pdf|docx?|xlsx?|pptx?|png|jpe?g|svg|ics)\b/i;
const NATIVE_FORMAT_SIGNAL = /\b(?:excel\s+workbook|word\s+(?:document|contract|file)|powerpoint\s+(?:deck|presentation|file)|(?:exact\s+)?csv(?:\s+import)?\s+file|ya?ml\s+(?:configuration\s+)?file|zip\s+archive|glb\s+(?:asset|file)|3d\s+(?:asset|file))\b/i;
const VISUAL_EXPLANATION = /\b(?:visual\s+(?:explanation|walkthrough|map)|show\s+me\s+how)\b/i;
const NEGATED_HTML_RENDER = /\b(?:do\s+not|don't|dont|never|avoid|skip)\s+(?:render|open|show|display|preview)\b/i;
const NEGATED_PREVIEW = /\b(?:do\s+not|don't|dont|never|avoid|skip)\b[^.!?;\n]{0,80}\b(?:open|render|preview|launch|show|display|view)\b/i;
const NEGATED_HTML_OUTPUT = /\b(?:do\s+not|don't|dont|never|avoid|skip)\b[^.!?;\n]{0,80}\b(?:raw\s+html|(?:custom|bespoke|standalone|self[- ]contained)\s+html|html\s+(?:page|artifact|file|prototype|deck|presentation))\b/i;
const NEGATED_DECK = /\b(?:do\s+not|don't|dont|never|avoid|skip)\b[^.!?;\n]{0,80}\b(?:slides?|slide\s+deck|presentation|pitch\s+deck|keynote)\b/i;
const DOCUMENT_DELIVERABLE = /(?:\b(?:write|draft|produce|create|prepare|format)\b[\s\S]{0,120}\b(?:document|handbook|manual|charter|glossary|guide|memo|brief|report|runbook|reference\s+note|architecture\s+decision\s+record|adr)\b|\bgive\s+me\b[\s\S]{0,60}\b(?:document|handbook|manual|charter|glossary|guide|memo|brief|report|runbook|reference\s+note|architecture\s+decision\s+record|adr)\b|\b(?:standalone|persistent|durable|lasting|reusable)\s+(?:[\w-]+\s+){0,3}(?:document|handbook|manual|charter|glossary|guide|memo|brief|report|runbook|reference\s+note)\b)/i;
const LINEAR_DOCUMENT_REQUEST = /(?:\b(?:write|draft|prepare)\b[\s\S]{0,120}\b(?:checklist|briefing)\b|\bturn\b[\s\S]{0,120}\binto\b[\s\S]{0,80}\b(?:brief|memo|report|document|guide)\b)/i;
const PERSISTENT_DECISION_LOG = /\b(?:lasting|written|persistent|durable)\b[\s\S]{0,50}\bdecision\s+log\b/i;
const MARKDOWN_TABLE_DELIVERABLE = /\b(?:compact\s+)?(?:decision|comparison|trade[- ]?off)\s+table\b/i;
const FILE_CREATION_VERB = /\b(?:create|generate|make|produce|export|write|save|return|give\s+me)\b/i;
const FILE_MUTATION_REQUEST = /\b(?:revise|edit|update|replace|reuse|populate)\b[\s\S]{0,200}\b(?:in\s+place|tracked\s+changes?|(?:word|native)\s+(?:styles?|format)|page\s+layout|preserv(?:e|ing)\b[\s\S]{0,110}\b(?:styles?|layouts?|format(?:ting)?|formulas?|named\s+ranges?|charts?|themes?|animations?|comments?|anchors?|key\s+order(?:ing)?)|existing\s+layouts?|return\s+the\s+edited|populate)\b/i;
const FILE_ARTIFACT_SIGNAL = /\b(?:exact|artifact|downloadable|ready\s+to\s+download|raw\s+(?:html\s+)?source|raw\s+contents?|native\s+file|as\s+a\s+file|file\s+itself)\b/i;
const EXACT_FILE_REUSE = /\b(?:hand\s+back|return|reuse)\b[\s\S]{0,140}\b(?:existing|already\s+supplied|attached|same\s+attachment|byte[- ]for[- ]byte|exactly\s+as\s+it\s+is|unchanged|no\s+(?:content|formatting)\s+changes?)\b|\b(?:existing|already\s+supplied|attached)\b[\s\S]{0,180}\b(?:hand\s+back|return|reuse|byte[- ]for[- ]byte|exactly\s+as\s+it\s+is|same\s+attachment|unchanged|exact\s+file|file\s+viewer|file\s+itself)\b/i;
const SCOPED_FILE_TRANSLATION_REJECTION = /\b(?:do\s+not|don't|dont|never)\b[\s\S]{0,80}\b(?:re[- ]?render|translate|convert)\b[\s\S]{0,100}\b(?:markdown|html|new\s+artifact|another\s+artifact)\b/i;
const NEGATED_DOCUMENT = /\b(?:do\s+not|don't|dont|no|without|avoid|skip)\b[^.!?;\n]{0,80}\b(?:create|write|draft|produce|render|open|show)?\s*(?:a\s+|the\s+|any\s+)?(?:document|markdown\s+(?:document|artifact))\b/i;
const NAMED_ARTIFACT_PATH = /\b(?:project|artifact|file|workbook|document|archive|source)\s+(?:named|called)\s+[`'"“]?((?:[\w@+.,-]+\/)*[\w@+.,-]+\.[a-z0-9]{1,12})[`'"”]?/i;
const HTML_SOURCE_REQUEST = /(?:\b(?:exact|raw)\s+(?:html\s+)?source\b|\b(?:show|display|inspect|view|give|open)\b[\s\S]{0,50}\b(?:html\s+)?source\b)/i;
const SOURCE_DISPLAY_REJECTION = /(?:\b(?:rather\s+than|instead\s+of)\s+(?:showing|displaying|returning)?\s*(?:(?:the|its)\s+)?(?:html\s+)?source\b|\b(?:do\s+not|don't|dont|never|avoid|skip)\b[^.!?;\n]{0,50}\b(?:show|display|return|open)\b[^.!?;\n]{0,60}\b(?:the\s+)?(?:html\s+)?source\b)/i;
const INLINE_HTML_PREVIEW = /\b(?:render|open|show|display|preview)\b[\s\S]{0,80}\b(?:this|the|following)\s+html\b[\s\S]{0,80}\b(?:live|rendered|inspect(?:able)?|page|browser|rather\s+than\s+(?:showing\s+)?source)\b/i;
const SUPPLIED_HTML_PREVIEW = /(?:<!doctype\s+html|<html[\s>])[\s\S]{0,600}\b(?:render|open|display|preview)\b[\s\S]{0,100}\b(?:supplied|existing|as[- ]is|page)\b/i;
const FILE_DISPLAY_VERB = /\b(?:open|show|display|view|render|inspect|preview)\b/i;
const TOOL_CONTENT_PRESENTATION = /\b(?:open|show|display|render|return|retrieve|bring\s+back|as\s+written|source|notes?|brief|document|report|graph|topology|diagram)\b/i;
const FILE_PATH = /(?:^|[\s`'"(])((?:\.?\.?\/|~\/|\/)?(?:[\w@+.,-]+\/)*[\w@+.,-]+\.(?:md|mdx|mmd|drawio|txt|log|json|ya?ml|toml|csv|tsv|ics|zip|glb|pdf|png|jpe?g|gif|webp|svg|mp4|m4v|mov|webm|mp3|wav|m4a|aac|flac|ogg|ts|tsx|js|jsx|py|go|rs|java|rb|css|scss|html?|docx?|xlsx?|pptx?))(?:$|[\s`'"),:;]|[.!?](?=$|\s))/i;
const GENERIC_NESTED_FILE_PATH = /(?:^|[\s`'"(])((?:\.?\.?\/|~\/|\/)?(?:[\w@+.,-]+\/)+[\w@+.,-]+\.[a-z0-9][a-z0-9_-]{0,15})(?:$|[\s`'"),:;]|[.!?](?=$|\s))/i;
const SANDBOX_FILE_PATH = /\bsandbox:((?:\/[\w@+.,-]+)+\.(?:md|mdx|mmd|drawio|txt|log|json|ya?ml|toml|csv|tsv|ics|zip|glb|pdf|png|jpe?g|gif|webp|svg|mp4|m4v|mov|webm|mp3|wav|m4a|aac|flac|ogg|html?|docx?|xlsx?|pptx?))\b/i;
const LOCAL_URL = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?(?:\/[^\s]*)?/i;
const WEB_URL = /https?:\/\/[^\s`'"<>]+/i;
const FILE_URL = /file:\/\/\/[^\s`'"<>]+/i;
const PRIOR_WEB_SURFACE = /\b(?:reopen|return\s+to|go\s+back\s+to)\b[\s\S]{0,100}\b(?:prototype|app|site|website|page|portal)\b[\s\S]{0,120}\b(?:just\s+viewing|viewed|preview|current|behaves?)\b/i;
const LINK_VISIT_REQUEST = /\b(?:visit|navigate\s+to|go\s+to|open)\b[\s\S]{0,100}\b(?:public|demo|provided|supplied|shared|gave\s+you)\b[\s\S]{0,60}\blink\b/i;
const APPLICATION_PREVIEW_INTENT = /\b(?:open|show|launch|view|inspect|display)\b[\s\S]{0,80}\bapplications?\b/i;
const LIVE_REVIEW_ENVIRONMENT = /\b(?:open|show|view|inspect|display)\b[\s\S]{0,100}\b(?:live\s+)?review\s+environment\b/i;
const LIVE_BRANCH_ENVIRONMENT = /\b(?:open|show|view|inspect|display)\b[\s\S]{0,100}\blive\s+(?:branch|preview|development|deployment)\s+environment\b/i;
const LIVE_SANDBOX_INTENT = /\b(?:open|show|view|inspect|display)\b[\s\S]{0,100}\blive\b[\s\S]{0,60}\bsandbox\b/i;
const TOOL_MARKDOWN_RETURN = /\b(?:output[_ -]?type\s*[`'":=]*(?:is\s+)?|returned\s+)(?:a\s+)?(?:structured\s+)?markdown(?:[_ -]document|\s+(?:document|body|content))\b/i;
const TOOL_MERMAID_RETURN = /\b(?:returned|output(?:[_ -]?type)?\s*[`'":=]*(?:is\s+)?)\b[\s\S]{0,100}\b(?:mermaid\s+(?:text|source|diagram)|(?:graph|flowchart)\s+(?:TD|TB|BT|RL|LR)\s*[;\n])\b/i;
const TOOL_COMPONENT_RETURN = /\b(?:component[_ -]?renderer|returned|rendered)\b[\s\S]{0,100}\b(?:filter\s*bar|pagination|combobox|dropzone|dialog|standard\s+[\w-]+\s+component)\b[\s\S]{0,120}\b(?:component|controls?|returned|completed|succeeded)\b/i;
const TOOL_HTML_RETURN = /\b(?:bespoke[_ -]?page[_ -]?generator|returned|generated)\b[\s\S]{0,140}\b(?:inline[, ]+)?self[- ]contained\s+html\s+(?:experience|page|document)|<!doctype\s+html\b/i;
const TOOL_PREVIEW_RETURN = /\b(?:(?:browser\s+)?navigation\s+succeeded|(?:supplied|existing|running)\s+(?:site|app|console)\s+(?:finished\s+)?load(?:ed|ing)|browser\s+status\s+is\s+ready)\b[\s\S]{0,180}\b(?:live\s+viewport|rendered\s+viewport|viewport\s+(?:is\s+)?available|browser\s+(?:is\s+)?ready)\b/i;
const TOOL_FILE_RETURN = /\b(?:artifact[_ -]?path|output[_ -]?path|saved[_ -]?path)\b[\s\S]{0,160}\b(?:\.[a-z0-9]{2,8})\b|\b(?:export|package|file)\b[\s\S]{0,100}\b(?:completed|succeeded|ready)\b[\s\S]{0,120}\b(?:artifact[_ -]?path|output[_ -]?path|saved[_ -]?path)\b/i;
const MCP_APP_RETURN = /\b(?:returned|includes?|contains?)\b[\s\S]{0,160}\b(?:live\s+ui\s+resource|functional\s+mcp\s+app\s+surface|rendered\s+interactive\s+[\w-]+\s+explorer)\b|\breturned[_ -]?ui\b[\s\S]{0,120}\b(?:present|working|controls?|exposes?)\b/i;
const RESEARCH_TASK = /(?:\b(?:research|investigate|investigation|survey)\b|\b(?:write|prepare|produce|create|present|summari[sz]e|give\s+me)\b[\s\S]{0,100}\b(?:report|audit|findings|literature\s+review|landscape|postmortem)\b)/i;
const ARTICLE_SHAPE = /\b(?:article|essay|memo|write[- ]?up|postmortem|report|brief)\b/i;
const COMPARISON_SIGNAL = /\b(?:compare|comparison|versus|vs\.?|trade[- ]?offs?|alternatives?|options?|pros\s+and\s+cons|decision)\b/i;
const PROCESS_SIGNAL = /\b(?:architecture|pipeline|workflow|lifecycle|data\s+flow|request\s+flow|pass(?:es|ing)?\s+through|branch(?:es|ing)?|causal|dependencies|relationship|how\s+.+\s+works)\b/i;
const METRIC_SIGNAL = /\b(?:metrics?|benchmark|performance|latency|throughput|costs?|status|health|kpis?|trend|distribution)\b/i;
const INCIDENT_SIGNAL = /\b(?:incident|outage|root\s+cause|timeline|failure|bottleneck|regression)\b/i;
const DECISION_SIGNAL = /\b(?:recommend|recommendation|evidence|risks?|constraints?|criteria|prioriti[sz]e|choose|decision)\b/i;

export function routeVisual(input: RouteInput): RouteDecision {
  const candidates = createCandidates();
  const prompt = normalizeText(input.userPrompt);
  const response = normalizeText(input.assistantResponse);
  const promptFilePath = firstFilePath(prompt);
  const nativeFileWork = promptFilePath !== null && FILE_MUTATION_REQUEST.test(prompt);
  const implementationTask = IMPLEMENTATION_TASK.test(prompt) && REPO_TARGET.test(prompt);
  const presentationIntent = implementationTask
    ? IMPLEMENTATION_RESULT_PRESENTATION.test(prompt)
    : PRESENTATION_VERB.test(prompt);
  const exactFileIntent = firstFilePath(prompt) !== null && EXACT_FILE_REUSE.test(prompt);
  const scopedFileNegation = exactFileIntent && SCOPED_FILE_TRANSLATION_REJECTION.test(prompt);
  const scopedNativeAppNegation = NATIVE_APP_NEGATION.test(prompt) && COMPOSE_EXPLICIT.test(prompt);

  add(candidates, VisualRoute.Transcript, 24, "baseline", "Short and ordinary work stays in the transcript.");

  // A user saying not to create UI is the only signal allowed to outrank a
  // rich tool result. Explicit restraint is part of an intuitive router.
  if (MINIMAL_ANSWER_ONLY.test(prompt)) {
    add(candidates, VisualRoute.Transcript, 500, "minimal-answer", "The user requested one scalar answer rather than presentation of the source material.");
    return finalize(candidates);
  }

  if ((VISUAL_NEGATION.test(prompt) || EXPLICIT_VISUAL_REJECTION.test(prompt) || ANSWER_ONLY_CONTEXT.test(prompt)) && !scopedFileNegation && !scopedNativeAppNegation) {
    add(candidates, VisualRoute.Transcript, 300, "explicit-negative", "The user explicitly asked for no visual surface.");
    return finalize(candidates);
  }

  if (input.stage === RouteStage.Response && response.length < 700 && NON_FULFILLMENT_RESPONSE.test(response)) {
    add(candidates, VisualRoute.Transcript, 600, "unfulfilled-response", "The response describes a future or unavailable surface rather than an artifact that exists now.");
    return finalize(candidates);
  }

  // Format words inside a coding task describe the code being changed, not
  // a second surface. Require an explicit request to present the result.
  if (implementationTask && !presentationIntent && !nativeFileWork) {
    add(candidates, VisualRoute.Transcript, 300, "implementation-work", "This is an implementation task, not a request to present its result visually.");
    return finalize(candidates);
  }

  if ((input.stage === RouteStage.Tool || input.toolResult !== undefined) && isErrorToolResult(input.toolResult)) {
    add(candidates, VisualRoute.Transcript, 400, "tool-error", "The tool failed before it produced a presentable artifact or UI surface.");
    return finalize(candidates);
  }

  scoreExplicitPrompt(candidates, prompt, { implementationTask, presentationIntent });

  if (input.stage === RouteStage.Tool || input.toolResult !== undefined || input.toolInput !== undefined) {
    scoreToolEvent(candidates, input, prompt);
  }

  if (input.stage === RouteStage.Response || response.length > 0) {
    scoreExistingResponse(candidates, response, prompt);
  }

  scoreImplicitPrompt(candidates, prompt, { implementationTask, presentationIntent });
  return finalize(candidates);
}

function scoreExplicitPrompt(
  candidates: Map<VisualRouteType, MutableCandidate>,
  prompt: string,
  context: { implementationTask: boolean; presentationIntent: boolean },
): void {
  if (prompt.length === 0) return;

  if (MARKDOWN_EXPLICIT.test(prompt) && !NEGATED_DOCUMENT.test(prompt) && (!FORMAT_META_CONTEXT.test(prompt) || DOCUMENT_DELIVERABLE.test(prompt)) && !DEFINITION_META_CONTEXT.test(prompt)) {
    add(candidates, VisualRoute.Markdown, 225, "explicit-format", "The user explicitly requested Markdown.", {
      preset: ARTICLE_SHAPE.test(prompt) ? RoutePreset.Article : RoutePreset.Brief,
    });
  }

  if (DOCUMENT_DELIVERABLE.test(prompt) && !NEGATED_DOCUMENT.test(prompt) && (!FORMAT_META_CONTEXT.test(prompt) || MARKDOWN_EXPLICIT.test(prompt)) && !DEFINITION_META_CONTEXT.test(prompt)) {
    add(candidates, VisualRoute.Markdown, 215, "document-deliverable", "The requested deliverable is a persistent linear document.", {
      preset: RoutePreset.Article,
    });
  }

  if (LINEAR_DOCUMENT_REQUEST.test(prompt) && !NEGATED_DOCUMENT.test(prompt) && !FORMAT_META_CONTEXT.test(prompt) && !DEFINITION_META_CONTEXT.test(prompt)) {
    add(candidates, VisualRoute.Markdown, 215, "document-deliverable", "The requested checklist or briefing is a structured linear document.", {
      preset: RoutePreset.Brief,
    });
  }

  if (PERSISTENT_DECISION_LOG.test(prompt)) {
    add(candidates, VisualRoute.Markdown, 215, "document-deliverable", "A lasting written decision log is a persistent linear document.", {
      preset: RoutePreset.Article,
    });
  }

  if (MARKDOWN_TABLE_DELIVERABLE.test(prompt) && !INTERACTIVE_TABLE_REQUEST.test(prompt)) {
    add(candidates, VisualRoute.Markdown, 200, "table-deliverable", "A compact decision table is already a native Markdown representation.", {
      preset: RoutePreset.Brief,
    });
  }

  if (DECK_EXPLICIT.test(prompt) && !NEGATED_DECK.test(prompt) && !FORMAT_META_CONTEXT.test(prompt) && !DEFINITION_META_CONTEXT.test(prompt) && (!context.implementationTask || context.presentationIntent)) {
    add(candidates, VisualRoute.Html, 240, "explicit-format", "A slide deck needs the expressive HTML deck runtime.", {
      preset: RoutePreset.Deck,
    });
  }

  if (HTML_EXPLICIT.test(prompt) && !NEGATED_HTML_OUTPUT.test(prompt) && !FORMAT_META_CONTEXT.test(prompt) && !DEFINITION_META_CONTEXT.test(prompt)) {
    add(candidates, VisualRoute.Html, 230, "explicit-format", "The user explicitly requested HTML.");
  }

  if (MERMAID_EXPLICIT.test(prompt) && !NEGATED_DIAGRAM.test(prompt) && !FORMAT_META_CONTEXT.test(prompt) && !DEFINITION_META_CONTEXT.test(prompt) && (!context.implementationTask || context.presentationIntent)) {
    add(candidates, VisualRoute.Mermaid, 185, "explicit-format", "The user requested a diagram format represented directly by Mermaid source.");
  }

  if (GRAPH_INTENT.test(prompt) && GRAPH_STRUCTURE.test(prompt) && !NEGATED_DIAGRAM.test(prompt) && !FORMAT_META_CONTEXT.test(prompt) && !DEFINITION_META_CONTEXT.test(prompt) && (!context.implementationTask || context.presentationIntent)) {
    add(candidates, VisualRoute.Mermaid, 210, "graph-affordance", "The request requires graph topology rather than a linear or component layout.");
  }

  const namedArtifact = namedArtifactPath(prompt);
  const path = firstFilePath(prompt) ?? namedArtifact;
  const rendersDiagramFile = path !== null && /\.(?:mmd|mermaid)$/i.test(path) && /\b(?:render|draw|show|edit|editable|graph|diagram)\b/i.test(prompt) && !/\b(?:source|exact\s+(?:bytes|contents?))\b/i.test(prompt);
  if (rendersDiagramFile) {
    add(candidates, VisualRoute.Mermaid, 250, "diagram-file", `The user wants to render ${path} as a diagram rather than inspect its source.`);
  }
  const rejectsSourceDisplay = SOURCE_DISPLAY_REJECTION.test(prompt);
  const wantsRenderedHtml = path !== null && /\.html?$/i.test(path) && (!NEGATED_HTML_RENDER.test(prompt) || rejectsSourceDisplay) && previewIsAllowed(prompt) && (!HTML_SOURCE_REQUEST.test(prompt) || rejectsSourceDisplay) && (/\b(?:render|preview)\b/i.test(prompt) || /\b(?:as\s+a\s+page|rendered|not\s+(?:its|the)\s+source|exactly\s+as\s+it\s+(?:currently\s+)?looks)\b/i.test(prompt) || /\b(?:open|view)\b[\s\S]{0,80}\b(?:html\s+page|browser\s+preview)\b/i.test(prompt));
  if (wantsRenderedHtml) {
    add(candidates, VisualRoute.WebPreview, 245, "existing-web-page", `The user wants to experience ${path} as a rendered page, not inspect its source.`);
  }
  if (INLINE_HTML_PREVIEW.test(prompt) && previewIsAllowed(prompt) && (!HTML_SOURCE_REQUEST.test(prompt) || SOURCE_DISPLAY_REJECTION.test(prompt))) {
    add(candidates, VisualRoute.WebPreview, 245, "inline-web-page", "The user wants supplied HTML rendered as a live page rather than returned as source.");
  }
  if (SUPPLIED_HTML_PREVIEW.test(prompt) && previewIsAllowed(prompt)) {
    add(candidates, VisualRoute.WebPreview, 300, "supplied-web-page", "The user supplied an existing HTML document to render as-is.");
  }
  if (path && !wantsRenderedHtml && FILE_CREATION_VERB.test(prompt) && (namedArtifact !== null || FILE_ARTIFACT_SIGNAL.test(prompt))) {
    add(candidates, VisualRoute.File, 500, "named-file-deliverable", `The user requested an exact file artifact (${path}).`, {
      strategy: RouteStrategy.Generate,
      viewer: viewerForPath(path),
    });
  }
  if (path && !wantsRenderedHtml && EXACT_FILE_REUSE.test(prompt)) {
    add(candidates, VisualRoute.File, 500, "exact-file-reuse", `The user requested the existing file ${path} without translation or modification.`, {
      strategy: RouteStrategy.Reuse,
      viewer: viewerForPath(path),
    });
  }
  if (path && FILE_MUTATION_REQUEST.test(prompt)) {
    add(candidates, VisualRoute.File, 500, "native-file-edit", `The user needs ${path} edited while preserving its native file semantics.`, {
      strategy: RouteStrategy.Generate,
      viewer: viewerForPath(path),
    });
  }
  if (path && FILE_DISPLAY_VERB.test(prompt) && !wantsRenderedHtml && !rendersDiagramFile && (!context.implementationTask || IMPLEMENTATION_FILE_PRESENTATION.test(prompt))) {
    add(candidates, VisualRoute.File, 265, "explicit-file", `The user asked to display an existing file (${path}).`, {
      viewer: viewerForPath(path),
    });
  }

  if (/\b(?:show|display|view|open)\b[\s\S]{0,80}\b(?:uncommitted\s+diff|git\s+diff|patch)\b/i.test(prompt)) {
    add(candidates, VisualRoute.File, 225, "explicit-file", "The user asked to inspect an existing diff exactly.", {
      viewer: "diff",
    });
  }

  if (previewIsAllowed(prompt) && !FORMAT_META_CONTEXT.test(prompt) && !DEFINITION_META_CONTEXT.test(prompt) && (PREVIEW_EXPLICIT.test(prompt) || RUNNING_APP_PREVIEW.test(prompt) || WEB_SURFACE_INTENT.test(prompt) || PRIOR_WEB_SURFACE.test(prompt) || LINK_VISIT_REQUEST.test(prompt) || APPLICATION_PREVIEW_INTENT.test(prompt) || LIVE_REVIEW_ENVIRONMENT.test(prompt) || LIVE_BRANCH_ENVIRONMENT.test(prompt) || LIVE_SANDBOX_INTENT.test(prompt) || (WEB_URL.test(prompt) && /\b(?:open|show|preview|view|inspect|click\s+through)\b/i.test(prompt)) || (FILE_URL.test(prompt) && /\b(?:render|preview|browser|inspect|open)\b/i.test(prompt)))) {
    const strongPreview = RUNNING_APP_PREVIEW.test(prompt) || WEB_SURFACE_INTENT.test(prompt) || PRIOR_WEB_SURFACE.test(prompt) || LINK_VISIT_REQUEST.test(prompt) || APPLICATION_PREVIEW_INTENT.test(prompt) || LIVE_REVIEW_ENVIRONMENT.test(prompt) || LIVE_BRANCH_ENVIRONMENT.test(prompt) || LIVE_SANDBOX_INTENT.test(prompt) || FILE_URL.test(prompt);
    add(candidates, VisualRoute.WebPreview, strongPreview ? 280 : 190, "explicit-preview", "The user explicitly asked to view a running web surface.");
  }

  const standardAffordanceCount = prompt.match(STANDARD_UI_AFFORDANCE)?.length ?? 0;
  const standardInteractiveSurface = standardAffordanceCount >= 2 && STANDARD_UI_SURFACE.test(prompt) && UI_CREATION_REQUEST.test(prompt);
  if (((COMPONENT_EXPLICIT.test(prompt) && !FORMAT_META_CONTEXT.test(prompt) && !DEFINITION_META_CONTEXT.test(prompt)) || standardInteractiveSurface || STANDARD_CONTROLS_REQUEST.test(prompt) || REUSABLE_UI_REQUEST.test(prompt) || COMPONENT_ARTIFACT_REQUEST.test(prompt) || STANDARD_UI_NOUN_REQUEST.test(prompt) || STANDARD_COMPONENT_REQUEST.test(prompt) || STANDARD_FORM_REQUEST.test(prompt) || STANDARD_CARD_COMPOSITION.test(prompt) || CROSS_SOURCE_UI.test(prompt)) && !NEGATED_COMPONENT.test(prompt) && (!context.implementationTask || context.presentationIntent)) {
    add(candidates, VisualRoute.Component, 175, "explicit-experience", "The requested experience maps to reusable interactive components.", {
      preset: presetForPrompt(prompt),
    });
  }

  if (COMPOSE_EXPLICIT.test(prompt) || NATIVE_APP_NEGATION.test(prompt)) {
    add(candidates, VisualRoute.Component, 205, "explicit-composition", "The user wants one agent-owned view composed across sources rather than a native app.", {
      preset: presetForPrompt(prompt),
    });
  }

  if ((BESPOKE_HTML.test(prompt) || BESPOKE_PAGE_REQUEST.test(prompt)) && !NEGATED_BESPOKE_EXPERIENCE.test(prompt) && (!context.implementationTask || context.presentationIntent)) {
    add(candidates, VisualRoute.Html, BESPOKE_PAGE_REQUEST.test(prompt) ? 300 : 220, "bespoke-experience", "The requested custom motion or rendering exceeds the standard component catalog.");
  }

  const nativeDeliverable = prompt.match(NATIVE_FILE_DELIVERABLE)?.[1];
  if (nativeDeliverable) {
    add(candidates, VisualRoute.File, 500, "native-deliverable", `The explicit ${nativeDeliverable.toUpperCase()} deliverable should remain a native file artifact.`, {
      strategy: RouteStrategy.Generate,
      viewer: viewerForPath(`artifact.${nativeDeliverable.toLowerCase()}`),
    });
  }

  const nativeFormat = prompt.match(NATIVE_FORMAT_SIGNAL)?.[0];
  if (nativeFormat && /\b(?:build|create|generate|make|produce|deliver|edit|revise|reuse|populate|give\s+me)\b/i.test(prompt)) {
    const nativePath = representativePathForNativeFormat(nativeFormat);
    add(candidates, VisualRoute.File, 500, "native-deliverable", `The explicit native ${nativeFormat} deliverable should remain a file artifact.`, {
      strategy: RouteStrategy.Generate,
      viewer: viewerForPath(nativePath),
    });
  }

  if (VISUAL_EXPLANATION.test(prompt) && PROCESS_SIGNAL.test(prompt) && /\b(?:branch|cycle|fan[- ]?out|gateway|pipeline|flow)\b/i.test(prompt)) {
    add(candidates, VisualRoute.Mermaid, 215, "visual-topology", "The user asked for a visual explanation of a branching relationship graph.");
  }
}

function scoreToolEvent(
  candidates: Map<VisualRouteType, MutableCandidate>,
  input: RouteInput,
  prompt: string,
): void {
  const appSignals = isErrorToolResult(input.toolResult) ? [] : detectMcpAppSignals(input.toolResult);
  if (appSignals.length > 0 && !NATIVE_APP_NEGATION.test(prompt) && !COMPOSE_EXPLICIT.test(prompt)) {
    add(candidates, VisualRoute.McpApp, 360, "mcp-app", appSignals[0] ?? "The tool returned an MCP App UI resource.");
  }

  const explicitMarkdownReturn = firstStringWhere(input.toolResult, (value) => TOOL_MARKDOWN_RETURN.test(value));
  if (explicitMarkdownReturn || ((TOOL_CONTENT_PRESENTATION.test(prompt) || MARKDOWN_EXPLICIT.test(prompt)) && (firstMatchingString(input.toolResult, /^text\/markdown(?:\s*;|$)/i) || firstStringWhere(input.toolResult, (value) => structuredMarkdownScore(value) >= 2)))) {
    add(candidates, VisualRoute.Markdown, 260, "tool-markdown", "The successful tool returned authored Markdown that can be rendered directly.", {
      preset: RoutePreset.Article,
    });
  }

  const explicitMermaidReturn = firstStringWhere(input.toolResult, (value) => TOOL_MERMAID_RETURN.test(value));
  if (explicitMermaidReturn || (TOOL_CONTENT_PRESENTATION.test(prompt) && (firstMatchingString(input.toolResult, /^text\/(?:x-)?mermaid(?:\s*;|$)/i) || firstStringWhere(input.toolResult, looksLikeRawMermaid)))) {
    add(candidates, VisualRoute.Mermaid, 260, "tool-mermaid", "The successful tool returned Mermaid source that can be rendered directly.");
  }

  if (firstStringWhere(input.toolResult, (value) => TOOL_COMPONENT_RETURN.test(value))) {
    add(candidates, VisualRoute.Component, 280, "tool-component", "The successful tool returned a standard reusable component surface.", {
      preset: presetForPrompt(prompt),
    });
  }

  if (firstStringWhere(input.toolResult, (value) => TOOL_HTML_RETURN.test(value))) {
    add(candidates, VisualRoute.Html, 280, "tool-html", "The successful tool returned a self-contained bespoke HTML experience.");
  }

  if (firstStringWhere(input.toolResult, (value) => TOOL_PREVIEW_RETURN.test(value))) {
    add(candidates, VisualRoute.WebPreview, 300, "tool-preview", "The browser tool exposed a ready rendered viewport for an existing web surface.");
  }

  const localUrl = firstMatchingString(input.toolResult, LOCAL_URL) ?? firstMatchingString(input.toolInput, LOCAL_URL);
  if (localUrl && (PREVIEW_EXPLICIT.test(prompt) || RUNNING_APP_PREVIEW.test(prompt) || WEB_SURFACE_INTENT.test(prompt) || APPLICATION_PREVIEW_INTENT.test(prompt)) && previewIsAllowed(prompt)) {
    add(candidates, VisualRoute.WebPreview, 300, "local-preview", `The tool exposed a local preview at ${localUrl}.`);
  }

  const returnedWebUrl = firstMatchingString(input.toolResult, WEB_URL);
  if (returnedWebUrl && !LOCAL_URL.test(returnedWebUrl) && (PREVIEW_EXPLICIT.test(prompt) || RUNNING_APP_PREVIEW.test(prompt) || WEB_SURFACE_INTENT.test(prompt) || LIVE_REVIEW_ENVIRONMENT.test(prompt) || LIVE_BRANCH_ENVIRONMENT.test(prompt) || LIVE_SANDBOX_INTENT.test(prompt) || /\b(?:deployed|production\s+web|take\s+me\s+to)\b/i.test(prompt)) && previewIsAllowed(prompt)) {
    add(candidates, VisualRoute.WebPreview, 300, "web-preview-url", `The tool exposed an existing web surface at ${returnedWebUrl}.`);
  }

  const richFile = detectRichFile(input.toolInput, input.toolResult);
  const explicitFileRequest = FILE_DISPLAY_VERB.test(prompt) || /\b(?:diff|csv|pdf|image|photo|photograph|log|spreadsheet|workbook|document|archive|native|exact|reuse|return)\b/i.test(prompt);
  const artifactProducingTool = /(?:^|[._-])(?:render|export|generate|create|write|save|download|screenshot|finalize|package|deliver)(?:[._-]|$)/i.test(input.toolName ?? "");
  const explicitFileReturn = firstStringWhere(input.toolResult, (value) => TOOL_FILE_RETURN.test(value));
  if (richFile && (explicitFileRequest || artifactProducingTool || explicitFileReturn)) {
    add(candidates, VisualRoute.File, artifactProducingTool || explicitFileReturn ? 500 : 260, "tool-file", `The tool produced or selected ${richFile.path}.`, {
      viewer: richFile.viewer,
    });
  }
}

function scoreExistingResponse(
  candidates: Map<VisualRouteType, MutableCandidate>,
  response: string,
  prompt: string,
): void {
  if (response.length === 0) return;

  const responseLocalUrl = response.match(LOCAL_URL)?.[0];
  if (responseLocalUrl && previewIsAllowed(prompt) && (RUNNING_APP_PREVIEW.test(prompt) || /\b(?:open|preview|browser|running|started)\b/i.test(response))) {
    add(candidates, VisualRoute.WebPreview, 300, "response-preview", `The completed response exposes a running local web surface at ${responseLocalUrl}.`);
  }

  const responseWebUrl = response.match(WEB_URL)?.[0];
  const completedPublicPreview = /\b(?:deployed|published|online|ready\s+to\s+(?:preview|view))\b/i.test(response)
    && /\b(?:show|open|view|preview|result|page|site|website)\b/i.test(prompt);
  if (responseWebUrl && previewIsAllowed(prompt) && (/\b(?:supplied|existing|review\s+build|render\b[\s\S]{0,60}\binteractively|interactive\s+(?:site|preview|surface))\b/i.test(response) || completedPublicPreview)) {
    add(candidates, VisualRoute.WebPreview, 300, "response-preview", `The response exposes an existing web surface at ${responseWebUrl}.`);
  }

  const responseFile = firstFilePath(response);
  const completedFile = responseFile !== null && !/\bnot\s+ready\b/i.test(response) && /\b(?:created|generated|saved|exported|completed|complete|attached|download|ready|exact\s+native\s+file)\b/i.test(response);
  if (completedFile) {
    add(candidates, VisualRoute.File, 240, "response-file", `The response confirms a completed native file artifact (${responseFile}).`, {
      strategy: RouteStrategy.Generate,
      viewer: viewerForPath(responseFile),
    });
  }

  const completedHtmlPreview = responseFile !== null && /\.html?$/i.test(responseFile) && /\b(?:existing|supplied\s+unchanged|unchanged)\b/i.test(response) && /\b(?:rendered\s+)?browser\s+preview\b/i.test(response);
  if (completedHtmlPreview) {
    add(candidates, VisualRoute.WebPreview, 300, "response-preview", `The response confirms that existing HTML (${responseFile}) is ready as a rendered browser preview.`);
  }

  const responseAffordanceCount = response.match(STANDARD_UI_AFFORDANCE)?.length ?? 0;
  if (responseAffordanceCount >= 2 && STANDARD_UI_SURFACE.test(response) && /\b(?:arranged|assembled|created|built|presented|rendered)\b/i.test(response)) {
    add(candidates, VisualRoute.Component, 220, "response-component", "The response confirms a completed surface made from standard reusable controls.", {
      preset: presetForPrompt(response),
    });
  }

  if (!/```(?:tsx?|jsx?)?\b/i.test(response) && /\b(?:composed|assembled|created|built)\b[\s\S]{0,100}\b(?:react\s+)?(?:[\w-]+\s+){0,3}component\b[\s\S]{0,120}\b(?:cards?|linked|combines?|controls?)\b/i.test(response)) {
    add(candidates, VisualRoute.Component, 220, "response-component", "The response confirms a completed component composition.", {
      preset: presetForPrompt(response),
    });
  }

  if (/\b(?:created|built|authored|made)\b[\s\S]{0,100}\b(?:new|bespoke|custom)\b[\s\S]{0,100}\b(?:story\s+page|microsite|web\s+experience|html\s+(?:page|experience))\b/i.test(response) && /\b(?:canvas|animated|bespoke|custom)\b/i.test(response)) {
    add(candidates, VisualRoute.Html, 230, "response-html", "The response confirms a newly authored bespoke web experience.");
  }

  if (/\b(?:authored|created|built|made)\b[\s\S]{0,140}\b(?:standalone|complete|new)\s+html\b/i.test(response) && /\b(?:canvas|animated|transitions?|full[- ]viewport|bespoke|presenter[- ]key)\b/i.test(response)) {
    add(candidates, VisualRoute.Html, 230, "response-html", "The response confirms a completed standalone HTML experience.", {
      ...(DECK_EXPLICIT.test(response) ? { preset: RoutePreset.Deck } : {}),
    });
  }

  if (/<!doctype\s+html\b[\s\S]{0,120}<html\b/i.test(response) && /\b(?:new|bespoke|custom)\b[\s\S]{0,100}\b(?:experience|page|story)\b/i.test(response)) {
    add(candidates, VisualRoute.Html, 230, "response-html", "The response contains the authored source of a new bespoke HTML experience.");
  }

  if (looksLikeStandaloneHtml(response)) {
    add(
      candidates,
      VisualRoute.Html,
      175,
      "existing-html",
      "The response is already predominantly HTML; reuse it rather than translating it.",
      DECK_EXPLICIT.test(prompt) ? { preset: RoutePreset.Deck } : {},
    );
  }

  const mermaid = mermaidResponseShape(response);
  if (mermaid === "standalone") {
    add(candidates, VisualRoute.Mermaid, 180, "existing-mermaid", "The response is essentially one Mermaid diagram and can be rendered directly.");
  } else if (mermaid === "embedded") {
    add(candidates, VisualRoute.Markdown, 115, "embedded-mermaid", "The Mermaid block belongs to a larger Markdown document; preserve the document as authored.", {
      preset: RoutePreset.Article,
    });
  }

  const markdownScore = structuredMarkdownScore(response);
  if (markdownScore >= 2) {
    const weight = Math.min(150, 80 + markdownScore * 10);
    add(candidates, VisualRoute.Markdown, weight, "existing-markdown", "The answer already has useful Markdown structure; rendering it directly avoids a second generation.", {
      preset: response.length > 2_500 ? RoutePreset.Article : RoutePreset.Brief,
    });
  }

  if (response.length < 500 && structuredMarkdownScore(response) < 2) {
    add(candidates, VisualRoute.Transcript, 45, "short-response", "The completed response is short enough that another surface would add friction.");
  }
}

function scoreImplicitPrompt(
  candidates: Map<VisualRouteType, MutableCandidate>,
  prompt: string,
  context: { implementationTask: boolean; presentationIntent: boolean },
): void {
  if (prompt.length === 0) return;

  // Ordinary coding work should not pop open a visual canvas merely because
  // the thing being implemented happens to be a dashboard or diagram.
  if (context.implementationTask && !context.presentationIntent) {
    add(candidates, VisualRoute.Transcript, 95, "implementation-work", "This is an implementation task, not a request to present an answer visually.");
    return;
  }

  if (RESEARCH_TASK.test(prompt)) {
    add(candidates, VisualRoute.Markdown, 68, "research-shape", "Research and findings are cheapest as a directly rendered structured document.", {
      preset: ARTICLE_SHAPE.test(prompt) ? RoutePreset.Article : RoutePreset.Brief,
    });
  }


  if (/\b(?:adr|architecture\s+decision\s+record|readme|release\s+notes?|runbook|prose[- ]first\s+(?:incident\s+)?narrative)\b/i.test(prompt)) {
    add(candidates, VisualRoute.Markdown, 105, "document-intent", "The requested deliverable is a persistent linear document.", {
      preset: RoutePreset.Article,
    });
  }

  const complexityFamilies = [
    COMPARISON_SIGNAL.test(prompt),
    PROCESS_SIGNAL.test(prompt),
    METRIC_SIGNAL.test(prompt),
    INCIDENT_SIGNAL.test(prompt),
    DECISION_SIGNAL.test(prompt),
  ].filter(Boolean).length;

  if (complexityFamilies >= 3) {
    add(candidates, VisualRoute.Component, 86 + complexityFamilies * 7, "cognitive-complexity", `${complexityFamilies} independent information structures benefit from a composed visual explanation.`, {
      preset: presetForPrompt(prompt),
    });
  } else if (complexityFamilies === 2 && context.presentationIntent) {
    add(candidates, VisualRoute.Component, 78, "cognitive-complexity", "The prompt combines multiple visual information structures.", {
      preset: presetForPrompt(prompt),
    });
  }

  if (prompt.length < 180 && complexityFamilies === 0 && !RESEARCH_TASK.test(prompt)) {
    add(candidates, VisualRoute.Transcript, 35, "simple-prompt", "No rich representation signal was detected.");
  }
}

function createCandidates(): Map<VisualRouteType, MutableCandidate> {
  return new Map(
    ROUTE_TIE_BREAK.map((route) => [
      route,
      { route, score: 0, evidence: [], strongestMetadataWeight: -Infinity },
    ]),
  );
}

function add(
  candidates: Map<VisualRouteType, MutableCandidate>,
  route: VisualRouteType,
  weight: number,
  signal: string,
  detail: string,
  metadata: CandidateMetadata = {},
): void {
  const candidate = candidates.get(route);
  if (!candidate) return;
  candidate.score += weight;
  candidate.evidence.push({ signal, detail, weight });
  if (weight >= candidate.strongestMetadataWeight) {
    if (metadata.strategy !== undefined) candidate.strategy = metadata.strategy;
    if (metadata.preset !== undefined) candidate.preset = metadata.preset;
    if (metadata.viewer !== undefined) candidate.viewer = metadata.viewer;
    candidate.strongestMetadataWeight = weight;
  }
}

function finalize(candidates: Map<VisualRouteType, MutableCandidate>): RouteDecision {
  const ranked = [...candidates.values()]
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return ROUTE_TIE_BREAK.indexOf(left.route) - ROUTE_TIE_BREAK.indexOf(right.route);
    });
  const winner = ranked[0] ?? candidates.get(VisualRoute.Transcript)!;
  const runnerUp = ranked[1];
  const margin = winner.score - (runnerUp?.score ?? 0);
  const confidence = confidenceFor(winner.score, margin);
  const strongest = [...winner.evidence].sort((a, b) => b.weight - a.weight)[0];

  const alternatives: RouteCandidate[] = ranked.slice(1, 4).map(stripMutableFields);
  return {
    route: winner.route,
    strategy: winner.strategy ?? ROUTE_STRATEGY[winner.route],
    shouldPresent: winner.route !== VisualRoute.Transcript,
    confidence,
    reason: strongest?.detail ?? "No richer representation was justified.",
    evidence: winner.evidence,
    alternatives,
    ...(winner.preset !== undefined ? { preset: winner.preset } : {}),
    ...(winner.viewer !== undefined ? { viewer: winner.viewer } : {}),
  };
}

function stripMutableFields(candidate: MutableCandidate): RouteCandidate {
  return {
    route: candidate.route,
    score: candidate.score,
    evidence: candidate.evidence,
    ...(candidate.strategy !== undefined ? { strategy: candidate.strategy } : {}),
    ...(candidate.preset !== undefined ? { preset: candidate.preset } : {}),
    ...(candidate.viewer !== undefined ? { viewer: candidate.viewer } : {}),
  };
}

function confidenceFor(score: number, margin: number): number {
  const strength = Math.min(0.99, 0.45 + score / 260);
  const marginFactor = Math.min(1, 0.68 + Math.max(0, margin) / 150);
  return Number(Math.max(0.5, strength * marginFactor).toFixed(2));
}

function presetForPrompt(prompt: string): RoutePresetType {
  if (/\bdashboard|metrics?|kpis?|status|health\b/i.test(prompt)) return RoutePreset.Dashboard;
  if (/\bform|configurator|calculator\b/i.test(prompt)) return RoutePreset.Form;
  if (/\btimeline|incident|outage\b/i.test(prompt)) return RoutePreset.Timeline;
  if (COMPARISON_SIGNAL.test(prompt)) return RoutePreset.Comparison;
  return RoutePreset.Explainer;
}

function structuredMarkdownScore(text: string): number {
  let score = 0;
  if (text.length >= 900) score += 1;
  if (text.length >= 2_500) score += 1;
  if ((text.match(/^#{1,4}\s+/gm) ?? []).length >= 2) score += 2;
  if ((text.match(/^\s*[-*+]\s+/gm) ?? []).length >= 4) score += 1;
  if ((text.match(/^\s*[-*+]\s+\[[ xX]\]\s+/gm) ?? []).length >= 2) score += 2;
  if ((text.match(/^\s*\d+[.)]\s+/gm) ?? []).length >= 3) score += 1;
  if (/^\|.+\|\s*\n\|?\s*:?-{3,}/m.test(text)) score += 2;
  if ((text.match(/```/g) ?? []).length >= 2) score += 1;
  if ((text.match(/\[[^\]]+\]\([^)]+\)/g) ?? []).length >= 3) score += 1;
  return score;
}

function mermaidResponseShape(text: string): "none" | "standalone" | "embedded" {
  if (looksLikeRawMermaid(text)) return "standalone";
  const blocks = [...text.matchAll(/```mermaid\s*\n[\s\S]*?```/gi)];
  if (blocks.length === 0) return "none";
  const outside = text.replace(/```mermaid\s*\n[\s\S]*?```/gi, "").replace(/[#*_>`-]/g, " ").trim();
  const outsideWords = outside.split(/\s+/).filter(Boolean).length;
  return blocks.length === 1 && outsideWords <= 80 ? "standalone" : "embedded";
}

function looksLikeRawMermaid(text: string): boolean {
  return /^(?:---[\s\S]{0,500}?---\s*)?(?:flowchart|graph|sequenceDiagram|stateDiagram(?:-v2)?|classDiagram|erDiagram|journey|gantt|mindmap|timeline|gitGraph|C4(?:Context|Container|Component|Dynamic|Deployment))\b/m.test(text.trim());
}

function looksLikeStandaloneHtml(text: string): boolean {
  const trimmed = text.trim();
  if (/^<!doctype\s+html/i.test(trimmed) || /^<html[\s>]/i.test(trimmed)) return true;
  const fenced = trimmed.match(/^```html\s*\n([\s\S]*?)```$/i);
  if (!fenced) return false;
  const body = fenced[1] ?? "";
  return /<(?:main|section|article|div|body)[\s>]/i.test(body);
}

function normalizeText(value: string | undefined): string {
  return value?.trim() ?? "";
}

function previewIsAllowed(prompt: string): boolean {
  return !NEGATED_PREVIEW.test(prompt) || SOURCE_DISPLAY_REJECTION.test(prompt);
}

function firstFilePath(text: string): string | null {
  return text.match(FILE_PATH)?.[1]?.trim() ?? text.match(SANDBOX_FILE_PATH)?.[1]?.trim() ?? text.match(GENERIC_NESTED_FILE_PATH)?.[1]?.trim() ?? null;
}

function namedArtifactPath(text: string): string | null {
  return text.match(NAMED_ARTIFACT_PATH)?.[1]?.trim() ?? null;
}

function representativePathForNativeFormat(format: string): string {
  if (/excel|workbook/i.test(format)) return "artifact.xlsx";
  if (/word/i.test(format)) return "artifact.docx";
  if (/powerpoint/i.test(format)) return "artifact.pptx";
  if (/csv/i.test(format)) return "artifact.csv";
  if (/ya?ml/i.test(format)) return "artifact.yaml";
  if (/zip/i.test(format)) return "artifact.zip";
  if (/glb|3d/i.test(format)) return "artifact.glb";
  return "artifact.bin";
}

function viewerForPath(path: string): string {
  const extension = path.toLowerCase().split(".").pop() ?? "";
  if (["csv", "tsv", "xlsx", "xls"].includes(extension)) return "table";
  if (extension === "ics") return "calendar";
  if (extension === "drawio") return "diagram";
  if (["glb", "gltf"].includes(extension)) return "3d";
  if (extension === "zip") return "archive";
  if (["ppt", "pptx"].includes(extension)) return "slides";
  if (["doc", "docx"].includes(extension)) return "document";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(extension)) return "image";
  if (["mp4", "m4v", "mov", "webm"].includes(extension)) return "video";
  if (["mp3", "wav", "m4a", "aac", "flac", "ogg"].includes(extension)) return "audio";
  if (extension === "pdf") return "pdf";
  if (extension === "log") return "log";
  if (path.toLowerCase().includes("diff") || path.toLowerCase().includes("patch")) return "diff";
  if (["md", "mdx"].includes(extension)) return "markdown";
  if (["txt", "json", "yaml", "yml", "toml", "ts", "tsx", "js", "jsx", "py", "go", "rs", "java", "rb", "css", "scss", "html", "htm", "sql"].includes(extension)) return "code";
  return "file";
}

function detectRichFile(toolInput: unknown, toolResult: unknown): { path: string; viewer: string } | null {
  const inputPath = firstPathValue(toolInput);
  const resultPath = firstPathValue(toolResult);
  const path = resultPath ?? inputPath;
  if (!path) return null;
  return { path, viewer: viewerForPath(path) };
}

function firstPathValue(value: unknown): string | null {
  let found: string | null = null;
  walkUnknown(value, (key, current) => {
    if (found || typeof current !== "string") return;
    const fileUrl = current.match(FILE_URL)?.[0];
    if (fileUrl) {
      found = pathFromFileUrl(fileUrl);
      return;
    }
    if (/^(?:file_?path|path|saved_?path|output_?path|artifact_?path|filename)$/i.test(key)) {
      const match = firstFilePath(` ${current} `);
      if (match) found = match;
    }
  });
  if (found) return found;
  const fileUrl = firstMatchingString(value, FILE_URL);
  if (fileUrl) return pathFromFileUrl(fileUrl);
  return firstMatchingString(value, FILE_PATH);
}

function pathFromFileUrl(fileUrl: string): string {
  const path = fileUrl.replace(/^file:\/\//i, "");
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function detectMcpAppSignals(value: unknown): string[] {
  const signals: string[] = [];
  walkUnknown(value, (key, current) => {
    if (typeof current !== "string") return;
    const normalizedKey = key.toLowerCase();
    const embeddedResource = current.match(/(?:ui|mcp-app):\/\/[^\s`'"<>)]+/i)?.[0];
    const resourceContext = /(?:uri|resource|template)/i.test(normalizedKey) || /\b(?:returned|registered|resource|output[_ -]?template)\b/i.test(current);
    if (embeddedResource && (current.trim().startsWith(embeddedResource) || resourceContext)) {
      signals.push(`The tool returned UI resource ${embeddedResource}.`);
    }
    if (normalizedKey.includes("mimetype") && isMcpAppMime(current)) {
      signals.push(`The tool returned interactive UI MIME type ${current}.`);
    }
    if (normalizedKey.includes("ui/resourceuri") || normalizedKey === "uiresourceuri") {
      signals.push(`The tool metadata declares an MCP App resource (${current}).`);
    }
    if (MCP_APP_RETURN.test(current)) {
      signals.push("The successful tool result explicitly declares a returned interactive MCP UI surface.");
    }
  });
  return [...new Set(signals)];
}

function isMcpAppMime(value: string): boolean {
  const [rawMediaType = "", ...rawParameters] = value.split(";");
  const mediaType = rawMediaType.trim().toLowerCase();
  if (mediaType === "text/html+mcp" || mediaType === "text/html+skybridge") return true;
  if (mediaType !== "text/html") return false;
  const parameters = new Map<string, string>();
  for (const rawParameter of rawParameters) {
    const equals = rawParameter.indexOf("=");
    if (equals < 0) continue;
    const name = rawParameter.slice(0, equals).trim().toLowerCase();
    const rawValue = rawParameter.slice(equals + 1).trim();
    parameters.set(name, rawValue.replace(/^(["'])(.*)\1$/, "$2").toLowerCase());
  }
  return parameters.get("profile") === "mcp-app";
}

function isErrorToolResult(value: unknown): boolean {
  if (typeof value === "string") return /^\s*(?:(?:[\w.-]+\s+)?(?:failed|failure|error)\b|(?:status\s*[:=]?\s*)?(?:failed|error)\b)/i.test(value);
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.isError === true || record.ok === false || record.success === false || record.error !== undefined;
}

function firstMatchingString(value: unknown, pattern: RegExp): string | null {
  let found: string | null = null;
  walkUnknown(value, (_key, current) => {
    if (found || typeof current !== "string") return;
    const match = current.match(pattern);
    if (match?.[0]) found = match[0];
  });
  return found;
}

function firstStringWhere(value: unknown, predicate: (value: string) => boolean): string | null {
  let found: string | null = null;
  walkUnknown(value, (_key, current) => {
    if (!found && typeof current === "string" && predicate(current)) found = current;
  });
  return found;
}

function walkUnknown(
  value: unknown,
  visit: (key: string, value: unknown) => void,
  key: string = "",
  depth: number = 0,
  seen: Set<object> = new Set(),
): void {
  if (depth > 8) return;
  visit(key, value);
  if (typeof value !== "object" || value === null) return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) walkUnknown(item, visit, key, depth + 1, seen);
    return;
  }
  for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) {
    walkUnknown(child, visit, childKey, depth + 1, seen);
  }
}

export function routeInstruction(decision: RouteDecision): string {
  switch (decision.route) {
    case VisualRoute.Transcript:
      return "Answer normally in the transcript; do not create a canvas slot.";
    case VisualRoute.Markdown:
      return "Preserve the answer as Markdown and present it directly; do not translate it into a component tree.";
    case VisualRoute.Mermaid:
      return "Author only Mermaid source and render it with the diagram surface.";
    case VisualRoute.File:
      return decision.strategy === RouteStrategy.Generate
        ? `Create the requested file artifact in its native format, then present it by path with the ${decision.viewer ?? "automatic"} viewer; do not translate it into another UI format.`
        : `Reference the existing file by path and use the ${decision.viewer ?? "automatic"} viewer; do not paste its contents.`;
    case VisualRoute.McpApp:
      return "Mount the MCP App UI returned by the tool; do not recreate its interface.";
    case VisualRoute.Component:
      return `Compose a structured component UI${decision.preset ? ` using the ${decision.preset} layout` : ""}.`;
    case VisualRoute.Html:
      return `Generate an HTML fragment${decision.preset === RoutePreset.Deck ? " for the host-provided deck runtime" : " against the host design system"}; omit CSS, document shell, and motion boilerplate.`;
    case VisualRoute.WebPreview:
      return "Open the existing running application in the web preview; do not recreate it.";
  }
}

export function routeEvidenceSummary(evidence: RouteEvidence[]): string {
  return evidence
    .slice()
    .sort((left, right) => right.weight - left.weight)
    .map((item) => `${item.signal}: ${item.detail}`)
    .join(" ");
}
