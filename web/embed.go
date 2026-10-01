// Package web embeds the built frontend. Run `make` to build dist first.
package web

import "embed"

//go:embed all:dist
var Dist embed.FS
