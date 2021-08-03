/* eslint-disable no-unused-vars */
/* eslint-disable react/jsx-no-undef */
/* eslint-disable no-undef */
class SymbolEnableActionIcon extends React.Component {
  constructor(props) {
    super(props);

    this.state = {
      showModal: false
    };

    this.handleModalShow = this.handleModalShow.bind(this);
    this.handleModalClose = this.handleModalClose.bind(this);

    this.handleDelete = this.handleDelete.bind(this);
  }

  handleModalShow() {
    this.setState({
      showModal: true
    });
  }

  handleModalClose() {
    this.setState({
      showModal: false
    });
  }

  handleDelete(e) {
    e.preventDefault();
    const { symbol } = this.props;
    this.props.sendWebSocket('symbol-enable-action', {
      symbol
    });

    this.handleModalClose();
  }

  render() {
    const { symbol, className, jsonStrings } = this.props;

    return (
      <span
        className={
          'header-column-icon-wrapper symbol-enable-action-wrapper ' + className
        }>
        <button
          type='button'
          className='btn btn-sm btn-link p-0 pl-1'
          onClick={this.handleModalShow}>
          <i className='fas fa-play-circle'></i>
        </button>

        <Modal show={this.state.showModal} onHide={this.handleModalClose}>
          <Modal.Header className='pt-1 pb-1'>
            <Modal.Title>
              {jsonStrings[6].resume_symbol_action} - {symbol}
            </Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {jsonStrings[6]._description[1]}
            <br />
            {jsonStrings[6]._description[2]}
            <br />
            {jsonStrings[6]._description[3]}
          </Modal.Body>
          <Modal.Footer>
            <Button
              variant='secondary'
              size='sm'
              onClick={this.handleModalClose}>
              {jsonStrings[1]._close}
            </Button>
            <Button
              type='button'
              variant='danger'
              size='sm'
              onClick={this.handleDelete}>
              {jsonStrings[1]._resume}
            </Button>
          </Modal.Footer>
        </Modal>
      </span>
    );
  }
}
