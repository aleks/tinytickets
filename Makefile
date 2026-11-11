.PHONY: build web test check run dev clean

build: web
	CGO_ENABLED=0 go build -trimpath -o tinytickets .

web:
	npm --prefix web ci
	npm --prefix web run build

test:
	go test -race $$(go list ./... | grep -v '/node_modules/')
	go vet $$(go list ./... | grep -v '/node_modules/')

# Asset writes finish before Go embeds them; browser tests use an isolated database.
check:
	npm --prefix web run check
	npm --prefix web run build
	CGO_ENABLED=0 go build -trimpath -o tinytickets .
	$(MAKE) test
	npm --prefix web run test:e2e

run:
	go run .

dev:
	npm --prefix web run dev

clean:
	rm -f tinytickets
