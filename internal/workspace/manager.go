package workspace

import (
	"context"
	"log"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"

	"github.com/fsnotify/fsnotify"

	"margin/internal/config"
	"margin/internal/index"
)

const reloadDelay = 300 * time.Millisecond

// Manager keeps the workspace in line with the config file, whether the
// config is changed through Apply or edited by hand.
type Manager struct {
	file     string
	publish  func(index.Event)
	onReload func(*Workspace)

	mu      sync.Mutex // serializes reloads
	current atomic.Pointer[Workspace]
	config  atomic.Pointer[loaded]
}

type loaded struct {
	config config.Config
	err    error // why the file on disk could not be used
}

// NewManager loads the config at file and opens its workspace. A config that
// cannot be used leaves the workspace empty and is reported by Config.
// onReload is called after every reload with the new workspace.
func NewManager(file string, publish func(index.Event), onReload func(*Workspace)) *Manager {
	m := &Manager{file: file, publish: publish, onReload: onReload}
	m.current.Store(&Workspace{byName: map[string]*Root{}, cancel: func() {}})
	m.config.Store(&loaded{})

	m.mu.Lock()
	defer m.mu.Unlock()
	c, err := loadValid(file)
	if err == nil {
		err = m.switchTo(c)
	}
	if err != nil {
		log.Printf("config: %v", err)
		m.config.Store(&loaded{err: err})
	}
	return m
}

func loadValid(file string) (config.Config, error) {
	c, err := config.Load(file)
	if err != nil {
		return config.Config{}, err
	}
	c = c.Normalize()
	return c, c.Validate()
}

func (m *Manager) File() string {
	return m.file
}

func (m *Manager) Workspace() *Workspace {
	return m.current.Load()
}

// Config returns the config in use and why the file on disk could not be
// used, if it could not.
func (m *Manager) Config() (config.Config, error) {
	l := m.config.Load()
	return l.config, l.err
}

// Apply validates c, saves it and switches to its workspace.
func (m *Manager) Apply(c config.Config) error {
	c = c.Normalize()
	if err := c.Validate(); err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := config.Save(m.file, c); err != nil {
		return err
	}
	return m.use(c)
}

// Watch reloads the config whenever its file changes, until ctx is done.
func (m *Manager) Watch(ctx context.Context) {
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		log.Printf("config watch: %v", err)
		return
	}
	defer watcher.Close()
	// Watch the directory: editors and Save replace the file by renaming.
	dir := filepath.Dir(m.file)
	for watcher.Add(dir) != nil {
		select {
		case <-ctx.Done():
			return
		case <-time.After(5 * time.Second): // wait for the directory to exist
		}
	}

	timer := time.NewTimer(reloadDelay)
	timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case ev := <-watcher.Events:
			if filepath.Clean(ev.Name) == filepath.Clean(m.file) {
				timer.Reset(reloadDelay)
			}
		case <-timer.C:
			m.reloadFromDisk()
		case err := <-watcher.Errors:
			log.Printf("config watch: %v", err)
		}
	}
}

func (m *Manager) Close() {
	m.current.Load().Close()
}

func (m *Manager) reloadFromDisk() {
	m.mu.Lock()
	defer m.mu.Unlock()

	current := m.config.Load().config
	c, err := loadValid(m.file)
	if err == nil && config.Equal(c, current) {
		m.config.Store(&loaded{config: current}) // our own save, or fixed back
		return
	}
	if err == nil {
		err = m.use(c)
	}
	if err != nil {
		log.Printf("config: %v", err)
		m.config.Store(&loaded{config: current, err: err})
	}
}

// use switches to c, re-indexing only when c indexes different files. Must
// be called with m.mu held.
func (m *Manager) use(c config.Config) error {
	if config.SameIndex(c, m.config.Load().config) && m.config.Load().err == nil {
		m.config.Store(&loaded{config: c})
		m.publish(index.Event{Kind: TreeChanged})
		return nil
	}
	return m.switchTo(c)
}

// switchTo opens the workspace for c and closes the previous one. Must be
// called with m.mu held.
func (m *Manager) switchTo(c config.Config) error {
	next, err := Open(c, m.publish, func() { m.publish(index.Event{Kind: TreeChanged}) })
	if err != nil {
		return err
	}
	previous := m.current.Swap(next)
	m.config.Store(&loaded{config: c})
	previous.Close()
	if m.onReload != nil {
		m.onReload(next)
	}
	m.publish(index.Event{Kind: TreeChanged})
	return nil
}

// TreeChanged is published when file metadata other than content changes,
// such as which worktree changed a file or which roots are served. Clients
// refetch the tree.
const TreeChanged index.Kind = "tree"

// HeadMoved is published with a repository whose HEAD moved, as on a
// commit or checkout, so what is committed may differ. Clients refetch the
// committed version of its open file.
const HeadMoved index.Kind = "head"
