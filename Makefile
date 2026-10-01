PREFIX ?= $(HOME)/.local

WEB_SOURCES := $(shell find web/src -type f) web/index.html web/package.json web/vite.config.ts
GO_SOURCES := $(shell find . -name '*.go' -not -path './web/node_modules/*')

.PHONY: all test roundtrip install clean

all: margin

web/dist/index.html: $(WEB_SOURCES)
	cd web && pnpm install --frozen-lockfile && pnpm build

margin: web/dist/index.html $(GO_SOURCES) go.mod
	go build -o margin .

test: web/dist/index.html
	go test ./...
	cd web && pnpm test

# Report which markdown files under ~/code don't survive an unchanged save
roundtrip:
	cd web && pnpm roundtrip

install: margin
	install -Dm755 margin $(PREFIX)/bin/margin

clean:
	rm -rf margin web/dist
