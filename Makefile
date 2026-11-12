.PHONY: build web test fmt-go fmt-check-go lint-go check run dev clean

# Pin the analysis tool without adding it to the application's module graph.
STATICCHECK_VERSION := v0.8.2

build: web
	CGO_ENABLED=0 go build -trimpath -o tinytickets .

web:
	npm --prefix web ci
	npm --prefix web run build

test:
	go test -race $$(go list ./... | grep -v '/node_modules/')
	go vet $$(go list ./... | grep -v '/node_modules/')

fmt-go:
	sh scripts/go-format.sh write

fmt-check-go:
	sh scripts/go-format.sh check

lint-go: fmt-check-go
	go vet $$(go list ./... | grep -v '/node_modules/')
	go run honnef.co/go/tools/cmd/staticcheck@$(STATICCHECK_VERSION) $$(go list ./... | grep -v '/node_modules/')

# Asset writes finish before Go embeds them; browser tests use an isolated database.
check:
	npm --prefix web run check
	npm --prefix web run build
	$(MAKE) lint-go
	CGO_ENABLED=0 go build -trimpath -o tinytickets .
	$(MAKE) test
	npm --prefix web run test:e2e

run:
	go run .

dev:
	npm --prefix web run dev

clean:
	rm -f tinytickets
