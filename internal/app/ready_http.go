package app

import (
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
)

// Claim bodies accept only their documented object fields. An absent body is
// equivalent to {} so an unscoped POST does not require a dummy JSON payload.
func readClaimBody(r *http.Request, out any) error {
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		return invalid("Request body is too large or unreadable")
	}
	text := strings.TrimSpace(string(raw))
	if text == "" {
		text = "{}"
	}
	if !strings.HasPrefix(text, "{") {
		return invalid("Input must be a JSON object")
	}
	dec := json.NewDecoder(strings.NewReader(text))
	dec.DisallowUnknownFields()
	if err := dec.Decode(out); err != nil {
		return invalid("Invalid claim input: " + err.Error())
	}
	if err := dec.Decode(new(any)); err != io.EOF {
		return invalid("Input must contain exactly one JSON object")
	}
	return nil
}

func postOnly(w http.ResponseWriter, r *http.Request) bool {
	if r.Method == http.MethodPost {
		return true
	}
	w.Header().Set("Allow", "POST")
	respond(w, nil, &APIError{405, "Method not allowed"}, 0)
	return false
}

func (a *App) readyTicketsHTTP(w http.ResponseWriter, r *http.Request) {
	if !readOnly(w, r) {
		return
	}
	var f ReadyFilter
	for key, dest := range map[string]**int64{"project_id": &f.ProjectID, "epic_id": &f.EpicID} {
		if values, ok := r.URL.Query()[key]; ok {
			if len(values) != 1 {
				respond(w, nil, invalid("Scope IDs must occur once"), 0)
				return
			}
			id, err := strconv.ParseInt(values[0], 10, 64)
			if err != nil || id <= 0 {
				respond(w, nil, invalid("Scope IDs must be positive integers"), 0)
				return
			}
			*dest = &id
		}
	}
	out, err := a.Store.ReadyTickets(r.Context(), f)
	respond(w, out, err, 200)
}

func (a *App) claimNextHTTP(w http.ResponseWriter, r *http.Request) {
	if !postOnly(w, r) {
		return
	}
	var f ReadyFilter
	if err := readClaimBody(r, &f); err != nil {
		respond(w, nil, err, 0)
		return
	}
	out, err := a.ClaimTicket(r.Context(), f, nil)
	respond(w, out, err, 200)
}

func (a *App) claimTicketHTTP(w http.ResponseWriter, r *http.Request) {
	if !postOnly(w, r) {
		return
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		respond(w, nil, invalid("A positive ticket_id is required"), 0)
		return
	}
	if err := readClaimBody(r, &struct{}{}); err != nil {
		respond(w, nil, err, 0)
		return
	}
	out, err := a.ClaimTicket(r.Context(), ReadyFilter{}, &id)
	respond(w, out, err, 200)
}
