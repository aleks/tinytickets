.PHONY: build web test run dev clean

build: web
	CGO_ENABLED=0 go build -trimpath -o tinytickets .

web:
	npm --prefix web ci
	npm --prefix web run build

test:
	go test -race ./...
	go vet ./...

run:
	go run .

dev:
	npm --prefix web run dev

clean:
	rm -f tinytickets
