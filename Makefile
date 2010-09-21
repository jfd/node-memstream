install:
	cp lib/memstream.js ~/.node_libraries

test-all:
	node tools/test.js -r test
