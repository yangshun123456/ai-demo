import re

with open('src/views/FileBrowserView.vue', 'r') as f:
    content = f.read()

old_tab_watch = """watch(() => workspace.activeTab, (newTab) => {
  if (editorInstance.value && newTab) {
    if (editorInstance.value.getValue() !== newTab.content) {
      editorInstance.value.setValue(newTab.content);
    }
    // Set language based on extension
    const ext = newTab.name.split('.').pop()?.toLowerCase();
    const langMap = {
      'js': 'javascript', 'json': 'json', 'vue': 'html', 'html': 'html', 
      'css': 'css', 'ts': 'typescript', 'yaml': 'yaml', 'yml': 'yaml'
    };
    monaco.editor.setModelLanguage(editorInstance.value.getModel(), langMap[ext] || 'plaintext');
  }
}, { deep: true });"""

new_tab_watch = """watch(() => workspace.activeTab, (newTab) => {
  if (editorInstance.value) {
    if (newTab) {
      if (editorInstance.value.getValue() !== newTab.content) {
        editorInstance.value.setValue(newTab.content);
      }
      // Set language based on extension
      const ext = newTab.name.split('.').pop()?.toLowerCase();
      const langMap = {
        'js': 'javascript', 'json': 'json', 'vue': 'html', 'html': 'html', 
        'css': 'css', 'ts': 'typescript', 'yaml': 'yaml', 'yml': 'yaml'
      };
      monaco.editor.setModelLanguage(editorInstance.value.getModel(), langMap[ext] || 'plaintext');
    } else {
      editorInstance.value.setValue('');
      monaco.editor.setModelLanguage(editorInstance.value.getModel(), 'plaintext');
    }
  }
}, { deep: true });"""

content = content.replace(old_tab_watch, new_tab_watch)

with open('src/views/FileBrowserView.vue', 'w') as f:
    f.write(content)
