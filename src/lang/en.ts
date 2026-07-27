/**
 * English language pack.
 *
 * The stoplist is deliberately compact: RAKE down-weights other common words via
 * the degree/frequency ratio, so it need not be exhaustive. What it *does* need
 * is conversational filler, because phrases are ranked by recurrence and chat
 * transcripts repeat "sounds good" far more often than any topic word. Rose et
 * al. (2010) expect the stoplist to be tuned to the corpus; this is that tuning.
 */

import type { LanguagePack } from "./types.ts";

export const english: LanguagePack = {
	id: "en",
	name: "English",

	stopwords: [
		// Function words.
		"a", "about", "above", "after", "again", "against", "all", "am", "an", "and", "any", "are",
		"aren't", "as", "at", "be", "because", "been", "before", "being", "below", "between", "both",
		"but", "by", "can", "can't", "cannot", "could", "couldn't", "did", "didn't", "do", "does",
		"doesn't", "doing", "don't", "down", "during", "each", "few", "for", "from", "further", "had",
		"hadn't", "has", "hasn't", "have", "haven't", "having", "he", "her", "here", "hers", "herself",
		"him", "himself", "his", "how", "i", "if", "in", "into", "is", "isn't", "it", "it's", "its",
		"itself", "just", "let", "let's", "lets", "me", "more", "most", "my", "myself", "no", "nor",
		"not", "now", "of", "off", "on", "once", "only", "or", "other", "ought", "our", "ours", "out",
		"over", "own", "please", "same", "shan't", "she", "should", "shouldn't", "so", "some", "such",
		"than", "that", "the", "their", "theirs", "them", "themselves", "then", "there", "these",
		"they", "this", "those", "through", "thanks", "thank", "to", "too", "under", "until", "up",
		"very", "want", "was", "wasn't", "we", "were", "weren't", "what", "when", "where", "which",
		"while", "who", "whom", "why", "will", "with", "won't", "would", "wouldn't", "you", "your",
		"yours", "yourself", "also", "like",

		// Conversational filler — recurs constantly in chat, never names a topic.
		"actually", "ah", "alright", "anything", "awesome", "basically", "bit", "cool", "correct",
		"exactly", "everything", "fine", "good", "great", "hello", "hey", "hi", "hmm", "indeed",
		"kind", "maybe", "nice", "nope", "nothing", "ok", "okay", "perfect", "pretty", "quite",
		"really", "seems", "something", "sort", "sounds", "stuff", "sure", "thing", "things", "wow",
		"yeah", "yep", "yes",

		// Modals and discourse particles — same reasoning.
		"ahead", "already", "always", "another", "anyway", "anyways", "back", "even", "ever", "may",
		"many", "might", "much", "must", "never", "next", "often", "rather", "shall", "still",
		"whatever", "yet",
	],

	genericActions: [
		"add", "added", "adds", "change", "changed", "changes", "check", "checked", "checks",
		"continue", "create", "created", "creates", "delete", "deleted", "deletes", "do", "done",
		"fix", "fixed", "fixes", "get", "gets", "give", "go", "help", "keep", "look", "looks", "make",
		"makes", "made", "need", "needs", "put", "read", "reads", "remove", "removed", "removes",
		"run", "running", "runs", "set", "sets", "show", "shows", "start", "stop", "take", "tell",
		"try", "update", "updated", "updates", "use", "used", "uses", "work", "works", "write",
		"writes",
	],

	minorWords: [
		"a", "an", "the", "and", "or", "but", "of", "to", "in", "on", "for", "with", "at", "by",
		"from", "as",
		// Prepositions that are *not* stopwords — they carry enough meaning to stay in a
		// phrase, but should not be capitalised inside a title ("Certificate via DNS").
		"onto", "per", "toward", "towards", "upon", "versus", "via", "vs",
	],
};
