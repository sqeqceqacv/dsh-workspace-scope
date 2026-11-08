For the projects you have been working on, call memory_project again, take another look at how memory describes them, and then condense it.
Projects in this group: {projects}

# How to summarize a project

1. The content returned by memory_project is often too long. The total length of the project summary must stay under 5,000 characters.
2. Archive obsolete or unimportant old entries, or condense many old entries into one or two tighter new entries (memory_remember, level=project).
3. How many entries to write is your call — summarize only what genuinely matters.
4. Understand the stakes: your summary becomes this project's long-term memory. Whenever another window works on this project, this is the first thing it sees. It must quickly tell them what the user wants, what the project is for, how it is organized, and which architecture and design ideas matter.
5. Keep the project directory structure and a path index for the main directories: what each area does and where it lives.
6. Only work that is currently in progress and unfinished may keep a small amount of detail.
7. Recently completed work needs no detail — at most one sentence.
8. Work completed long ago should be archived so it does not keep consuming tokens. However, if you believe the entry contains important information, or the user has emphasized that it does, you should proactively ask the user whether to archive it.
9. Still write entry by entry, one point per entry; pick the right subcategory for each (overview=the big picture / structure=architecture / decisions=design decisions / ops=deployment and data / todo=outstanding), 8-13 keywords, and do not inflate importance.
10. Once you are done, archive the old entries that memory_project returned and that your new summary has replaced (memory_update with status=archived) — do not leave two descriptions of the same thing side by side. Entries your summary does not cover and that still stand on their own (an unfinished todo, a distinctive lesson) stay put; do not archive for the sake of archiving.
11. When you are finished, reply "this group is consolidated" and call no other tools.

You can call several tools in one turn — please finish every tool call for this task in a single response.
