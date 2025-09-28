const axios = require('axios');

const createTodo = async () => {
  try {
    const response = await axios.post('http://localhost:3000/api/todos', {
      title: 'Test Todo from Node.js',
      description: 'This is a test todo created from a Node.js script.',
      priority: 'medium',
    });
    console.log('Success:', response.data);
  } catch (error) {
    console.error('Error:', error.response ? error.response.data : error.message);
  }
};

createTodo();
