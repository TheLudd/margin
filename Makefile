# margin: one Go binary with the frontend embedded. Node is needed only to build.

.PHONY: all build web install test test-go test-web test-e2e roundtrip clean

all: build

web/node_modules: web/package.json web/pnpm-lock.yaml
	cd web && pnpm install --frozen-lockfile
	@touch web/node_modules

web: web/node_modules
	cd web && pnpm build

build: web
	go build -o margin .

# P-08: the binary for the systemd user service.
install: build
	mkdir -p $(HOME)/.local/bin
	install -m 755 margin $(HOME)/.local/bin/margin

test: test-go test-web test-e2e

test-go:
	go test ./...

test-web: web/node_modules
	cd web && pnpm test

test-e2e: build
	cd web && pnpm e2e

# D-05: report the files under ~/code an unchanged save would alter.
roundtrip: web/node_modules
	cd web && pnpm roundtrip

clean:
	rm -rf margin web/dist
