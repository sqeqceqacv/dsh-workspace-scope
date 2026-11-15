# meow-memory tool copy (key-value lines: `- key: value`; the first ASCII colon+space is the separator, the value is kept verbatim; a line starting with two spaces continues the previous value. `###` headings are for readers only and are ignored by the parser.
# Key convention: <tool>.description / <tool>.param.<name> / <tool>.out.<path>. A missing key throws; new keys must be mirrored in src/tools.ts.)

### memory_remember

- memory_remember.description: Write something worth remembering across sessions into this workspace's memory store (SQLite, one table per level). Required: content / project ("global", or a project name; comma-separate several) / keywords (8-13 retrieval keywords) / importance. Leaving one out raises an error asking you to fill it in. Levels: soul=the AI itself (use sparingly); project=a project (e.g. project-a/project-b); rules=workspace design principles / behavioral guidelines (a workspace-wide rule takes project "global" (across projects in this workspace, not across workspaces), and with importance>=2 it is injected in full on the first turn;  a project-specific rule takes that project's name and is injected with memory_project; everything else surfaces through search); fact=small atomic facts (one plain sentence, <=30 words); lesson=what you learned, your own experience (anything you were corrected on belongs here); topic=a thread (give it a goal sentence; retrieved by keywords). Hard rule: when the user explains a project's design thinking, framework, or the reasoning behind a decision, content must preserve the user's own wording — do not paraphrase or summarize it away. Entries that heavily overlap an existing one are merged automatically (updated, not duplicated). The tool confirms on success — no need to call it again.
- memory_remember.param.content: What to remember; fact/lesson one sentence <=30 words; topic <=180 words; wherever the user's own words are involved, keep their wording.
- memory_remember.param.level: Memory level, default fact.
- memory_remember.param.domain: What the memory is for, default content. content=workspace content knowledge (novel settings, project content, etc., part of theme matching); tooling=tool/environment pitfalls from working on projects in this workspace (MCP, PowerShell, paths, plugins), not part of content-theme matching and used only in this workspace.
- memory_remember.param.project: Required. Project name (must be a concrete project name when level=project); use "global" for information that applies across projects in this workspace (not across workspaces); comma-separate several projects, e.g. "project-a,project-b".
- memory_remember.param.subcategory: project subcategory: overview=purpose and summary / structure=architecture / decisions=technical decisions / quotes=the user's own words / ops=deployment and data / todo=in progress.
- memory_remember.param.goal: The topic's goal sentence (recommended when level=topic, e.g. "get the project-a integration working").
- memory_remember.param.importance: Importance (any number, no upper bound; soft guide 1-4: 4=fatal red line / health and safety, 3=stressed by the user / workspace-wide, 2=a user decision or an abstract conclusion, 1=trivia).
- memory_remember.param.corrected: Whether this is something the user corrected (for level=lesson).
- memory_remember.param.keywords: Required, 8-13 retrieval keywords. Omitting it raises an error; there is no automatic extraction.
- memory_remember.out.keywords: The keywords actually stored (after a merge, the latest value).
- memory_remember.out.project: The project actually recorded (if any).

### memory_search

- memory_search.description: Search this workspace's memory store (BM25 x recency weight). query is required and must not be empty — pass the keywords or sentence you are looking for, e.g. memory_search({query: "memory plugin deployment"}); to browse a whole project use memory_project (no query needed), don't call this tool with an empty query. What comes back: default top 10 = the first 5 straight off the relevance ranking (nothing excluded, including entries already injected/searched/created this session) + 5 more taken from further down the ranking while skipping already-injected/already-searched entries (so you get fresh material). Default scope = fact+lesson+topic+rules; level accepts a comma-separated list (e.g. fact,lesson); pass level=project for the project-wide view. Results are taken top-k by relevance and then re-sorted by memory timestamp (old -> new), so you can see how things developed and which of two conflicting entries is newer.
- memory_search.param.query: Search keywords or sentence (required, must not be empty; e.g. "memory plugin deployment").
- memory_search.param.level: Restrict to levels, comma-separated: fact/lesson/topic/rules/project/soul (default fact,lesson,topic,rules).
- memory_search.param.project: Filter by project name (comma-separated, OR semantics, e.g. "project-a,project-b"; entries marked "global" (workspace-wide) and unlabeled entries are always included).
- memory_search.param.status: Filter by status (comma-separated: active/archived/stale/all; default active, where a stale todo counts as completed and still participates; including all = no filter).
- memory_search.param.days: Only entries created in the last N days (by creation time).
- memory_search.param.k: Maximum number of results.
- memory_search.param.content_max: Truncate each entry's content to this length, 0=full text.
- memory_search.out.note: Conflict note.
- memory_search.out.hits.id: Full memory id (pass it to memory_read/memory_update/memory_find_similar).
- memory_search.out.hits.keywords: The entry's stored keywords.
- memory_search.out.hits.project: Project the entry belongs to; ""=unlabeled; workspace-wide entries read "global".
- memory_search.out.hits.updated_at: Memory timestamp (last update, in milliseconds).

### memory_find_similar

- memory_find_similar.description: Find entries similar to a given memory id (cosine over term-frequency vectors) — for spotting duplicates, finding conflicts, and checking whether something close to this entry already exists. Like search, it only looks at memories created in other sessions; anything already seen in this session (injected or searched) is excluded automatically.
- memory_find_similar.param.id: The reference memory id (the full id from memory_read/search results, or its first 12 characters).
- memory_find_similar.param.k: Number of results.
- memory_find_similar.param.content_max: Truncate each entry's content to this length, 0=full text.
- memory_find_similar.out.hits.similarity: Cosine similarity 0-1; higher is closer.

### memory_read

- memory_read.description: Read one memory in full (including title/keywords/importance/status metadata).
- memory_read.param.id: Memory id (from the injection block or a memory_search result).

### memory_update

- memory_update.description: Update a memory (content / importance / status / project / topic goal sentence / keywords, ...). status values: active / stale (finished: a completed todo, a topic that reached its goal -> stale means done) / archived (archived/soft-deleted: removed from default injection and default search, but still stored, readable via memory_read, and restorable).
- memory_update.param.id: Memory id.
- memory_update.param.domain: What the memory is for (content/tooling); pass tooling to turn an entry into tooling experience, which is not part of content-theme matching.
- memory_update.param.content: New content (when rewriting a topic: cause, course, development, outcome, <=180 words).
- memory_update.param.status: New status.
- memory_update.param.importance: New importance (any number, no upper bound; soft guide 1-4: 4=fatal red line / health and safety, 3=stressed by the user / workspace-wide, 2=a user decision or an abstract conclusion, 1=trivia).
- memory_update.param.goal: New goal sentence (topic).
- memory_update.param.project: New project name (project/fact/lesson/rules/topic); use "global" for information that applies across projects in this workspace (not across workspaces); comma-separate several projects; an empty string clears it (unlabeled).
- memory_update.param.keywords: Keywords you choose (fix or extend them whenever you notice they are off; omitting the parameter or passing an empty array leaves the keywords untouched).

### memory_project

- memory_project.description: Retrieve a project's complete injection block from the memory store (plain text, grouped by subcategory, every entry that is not out of date at once). project is required: which project do you want to see? Calling without it raises an error, so settle on the project name first. Call it when the user brings up a project (project-a/project-b, ...) and asks about its design history, technical decisions, their own past words, or where it stands; also whenever you need the project-wide picture before you answer. Rules: within a group, entries run old -> new by memory timestamp; the todo subcategory prints "Done:" (the 5 most recently completed) followed by "To do list:"; every entry carries its full id, its last-updated timestamp, and its text.
- memory_project.param.project: Project name (the memory guide at the start of the session lists every project the user has — pick from it).
- memory_project.out.text: The project's memory block, grouped by subcategory (plain text).

### memory_dream

- memory_dream.description: Schedule a memory consolidation (dream) for this window right now: everything this window created or pulled up is sent to the main agent round by round to be tidied and put away (round 1 = atomic memories, project/fact/lesson/rules/soul; round 2 = topic memories; round 3 = project summary, added only when this window actually touched a project). It triggers automatically after 3+ hours of window idle time (suppressed during peak hours, 09:00-12:00 and 14:00-18:00 Beijing time, plus the 15 minutes before each); this tool is the manual trigger.

### memory_home

- memory_home.description: View or switch the meow-memory global data directory (where instance-level data such as logs and the dream window ledger lives; the memory store itself sits inside each project and is unaffected). Call without parameters to get the current directory and the real locations of the three presets; switching automatically moves the old directory contents over (same-disk move / cross-disk copy). After a cross-disk copy the old directory is kept, not deleted - remind the user to delete it manually once verified; if several dsh instances share one directory, remind the user to update them together. Call this when the user wants to move memory data or logs off the system drive or to another location.
- memory_home.param.target: Target location. Either a preset marker: default = system user home (the default), dsh-storage = meow-memory folder under the DSH home's storages, plugin-root = storage folder next to the plugin itself; or an absolute path. Omit to view the current state without changing anything.
- memory_home.out.note: View/switch result: the current or new directory, how many files were moved, and what to do with the old directory.
### memory_theme

- memory_theme.description: Set or skip the memory theme for this workspace. The theme scopes memories to a project/domain; call it only after the user confirms. For action=set, theme is required; action=skip means never ask for a theme again.
- memory_theme.param.action: set=set a theme; skip=do not set a theme.
- memory_theme.param.theme: Theme name, 2-12 characters, at most 40 characters; required for action=set.
