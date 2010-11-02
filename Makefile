install:
	cp lib/memstream.js ~/.node_libraries

test-all:
	node tools/node-test/lib/test.js -r test
