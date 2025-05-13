const { render, screen } = require('@testing-library/react');
const ChatMessages = require('../ChatMessages');

test('hello world!', () => {
	render(<ChatMessages />);
	const linkElement = screen.getByText(/hello world/i);
	expect(linkElement).toBeInTheDocument();
});