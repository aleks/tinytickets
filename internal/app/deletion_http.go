package app

import (
	"net/http"
	"strconv"
)

func (a *App) deletionPreviewHTTP(w http.ResponseWriter, r *http.Request) {
	if !readOnly(w, r) {
		return
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		respond(w, nil, invalid("Invalid ID"), 0)
		return
	}
	p, err := a.Store.DeletionPreview(r.Context(), r.PathValue("kind"), id)
	respond(w, p, err, 200)
}
