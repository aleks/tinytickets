package app

import (
	"net/http"
	"strconv"
)

func (a *App) workLogHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodPost {
		w.Header().Set("Allow", "GET, POST")
		respond(w, nil, &APIError{405, "Method not allowed"}, 0)
		return
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		respond(w, nil, invalid("A positive ticket ID is required"), 0)
		return
	}
	if r.Method == http.MethodGet {
		out, err := a.Store.TicketWorkLog(r.Context(), id)
		respond(w, out, err, 200)
		return
	}
	var in WorkLogNoteInput
	if err := readObjectBody(r, &in); err != nil {
		respond(w, nil, err, 0)
		return
	}
	out, err := a.AddWorkLog(r.Context(), id, in)
	respond(w, out, err, 201)
}

func (a *App) reviewHandoffHTTP(w http.ResponseWriter, r *http.Request) {
	if !postOnly(w, r) {
		return
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		respond(w, nil, invalid("A positive ticket ID is required"), 0)
		return
	}
	var in ReviewHandoffInput
	if err := readObjectBody(r, &in); err != nil {
		respond(w, nil, err, 0)
		return
	}
	out, err := a.CreateReviewHandoff(r.Context(), id, in)
	respond(w, out, err, 201)
}
