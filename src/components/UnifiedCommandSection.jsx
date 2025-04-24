import React, { useState, useEffect, useRef } from 'react';
import './UnifiedCommandSection.css';
import { getActiveTasks, cancelTask } from '../api/tasks';
import { eventBus } from '../utils/events.js';

// Placeholder for Three.js effects (to be integrated in future steps)
// import { ThreeCardEffect } from '../effects/ThreeCardEffect';

const UnifiedCommandSection = () => {
  const [command, setCommand] = useState('');
  const [tasks, setTasks] = useState([]);
  const [results, setResults] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    fetchTasks();
    eventBus.on('task-result', handleTaskResult);
    return () => eventBus.off('task-result', handleTaskResult);
  }, []);

  const fetchTasks = async () => {
    const response = await getActiveTasks();
    if (response && Array.isArray(response.tasks)) {
      setTasks(response.tasks);
    }
  };

  const handleTaskResult = (result) => {
    setResults((prev) => [result, ...prev]);
  };

  const handleCommandSubmit = async (e) => {
    e.preventDefault();
    if (!command.trim()) return;
    setIsSubmitting(true);
    // TODO: Integrate with actual command/task submission logic
    setTimeout(() => {
      setResults((prev) => [{
        id: Date.now(),
        command,
        result: `Simulated result for: ${command}`
      }, ...prev]);
      setIsSubmitting(false);
      setCommand('');
    }, 700);
  };

  const handleCancelTask = async (taskId) => {
    await cancelTask(taskId);
    fetchTasks();
  };

  return (
    <div className="unified-command-section cyberpunk-card">
      <form className="command-input-form" onSubmit={handleCommandSubmit}>
        <input
          ref={inputRef}
          className="command-input cyberpunk-input"
          type="text"
          placeholder="Type your command..."
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          disabled={isSubmitting}
        />
        <button
          className="submit-btn cyberpunk-btn"
          type="submit"
          disabled={isSubmitting || !command.trim()}
        >
          {isSubmitting ? 'Processing...' : 'Send'}
        </button>
      </form>
      <div className="active-tasks-list">
        {tasks.length === 0 ? (
          <div className="no-tasks">No active tasks</div>
        ) : (
          tasks.map((task) => (
            <div key={task.id} className="task-card cyberpunk-task-card">
              <div className="task-meta">
                <span className="task-title">{task.title || `Task #${task.id}`}</span>
                <span className="task-status">{task.status}</span>
              </div>
              <div className="task-actions">
                <button className="cancel-btn cyberpunk-btn" onClick={() => handleCancelTask(task.id)}>
                  Cancel
                </button>
              </div>
            </div>
          ))
        )}
      </div>
      <div className="task-results-list">
        {results.length === 0 ? (
          <div className="no-results">No results yet</div>
        ) : (
          results.map((res) => (
            <div key={res.id} className="result-card cyberpunk-result-card animate-in">
              <div className="result-command">{res.command}</div>
              <div className="result-output">{res.result}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default UnifiedCommandSection;
