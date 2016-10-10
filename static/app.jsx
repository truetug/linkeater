var config = {
  defaultUrl: 'http://ya.ru\nhttp://google.com\nhttp://facebook.com\nhttp://mail.ru',
  urls: {
    task: '/api/task/',
  },
  taskBoxRefreshPeriodicity: 500
};

var Root = React.createClass({
  render: function(){
    return (
      <div>
        <TasksBox />
      </div>
    )
  }
}),
Paginator = React.createClass({
  getInitialState: function() {
    return {
      near: 3
    };
  },
  render: function(){
    var first = Math.max(this.props.current - this.state.near, 0),
        last = Math.min(this.props.current + this.state.near, this.props.total),
        nextLink = (this.props.next) ? (
          <li className="pagination-next"><a href={this.props.next} aria-label="Next page" onClick={this.props.handlePageChange.bind(null, this.props.current + 1)}>Next</a></li>
        ) : (
          <li className="pagination-next disabled">Next</li>
        ),
        prevLink = (this.props.previous) ? (
          <li className="pagination-previous"><a href={this.props.previous} aria-label="Previous page" onClick={this.props.handlePageChange.bind(null, this.props.current - 1)}>Previous</a></li>
        ) : (
          <li className="pagination-previous disabled">Previous</li>
        ),
        pageList = [];

    for(let i=first; i<last; i++) {
      pageList.push({
        number: i,
        display: i + 1,
        title: 'Page ' + i,
        url: config.urls.task + '?page=' + i,
        isCurrent: i == this.props.current
      });
    };

    return (
      <div className="b-pagination">
        <div className="row">
          <div className="small-12 column">
            <ul className="pagination text-center" role="navigation" aria-label="Pagination">
              {prevLink}
              {pageList.map((item, i) => {
                var result = (item.isCurrent) ? (
                  <li key={item.number} className="current">
                    <span className="show-for-sr">You are on page</span> {item.display}
                  </li>
                ) : (
                  <li key={item.number}>
                    <a href={item.url} aria-label={item.title} onClick={this.props.handlePageChange.bind(null, item.number)}>{item.display}</a>
                  </li>
                )

                return result;
              })}
              {nextLink}
            </ul>
          </div>
        </div>
      </div>
    )
  }
}),
TasksBox = React.createClass({
  getInitialState: function() {
    return {
      page: 0,
      url: config.defaultUrl,
      tasks: []
    };
  },
  componentDidMount: function() {
    this.loadDataFromServer();
    setInterval(this.loadDataFromServer, config.taskBoxRefreshPeriodicity);
  },
  loadDataFromServer: function() {
    var _this = this;

    axios.get(config.urls.task, {
      params: {page: this.state.page}
    })
      .then(function(response){
        // console.log(response);
        _this.setState({tasks: response.data.objects});
      })
      .catch(function(error) {
        console.log(error);
      });
  },
  handlePageChange: function(page, e) {
    e.preventDefault();

    this.setState({page: page});
    console.log('Switch to page', page);
  },
  handleChangeUrl: function(e) {
    this.setState({url: e.target.value});
  },
  handleAddTask: function(e) {
    e.preventDefault();
    var _this = this;

    this.state.url.split('\n').map(url => {
      axios.post(config.urls.task, {
        url: url.trim()
      })
        .then(function(response) {
          console.log(response);
          _this.setState({url: ''});
        })
        .catch(function(error) {
          console.log(error);
        });
    })
  },
  handleRemoveTask: function(slug, e){
    e.preventDefault();
    var _this = this,
        url = config.urls.task + slug + '/';

    axios.delete(url, {})
      .then(function(response) {
        console.log(response);
      })
      .catch(function(error) {
        console.log(error);
      });
  },
  render: function() {
    return (
      <div className="b-tasksbox">
        <div className="row">
          <h1>TasksBox</h1>
          <TasksForm
            url={this.state.url}
            handleAddTask={this.handleAddTask}
            handleChangeUrl={this.handleChangeUrl} />
        </div>
        <div className="row">
          <TasksList
            handleRemoveTask={this.handleRemoveTask}
            tasks={this.state.tasks} />
        </div>
        <TasksList
          handleRemoveTask={this.handleRemoveTask}
          handlePageChange={this.handlePageChange}
          {...this.state} />
      </div>
    );
  }
}),
TasksList = React.createClass({
  render: function() {
    return (
        <div className="b-taskslist">
          <div className="row">
          {this.props.tasks.map((task) => {
            var progressCls = ['progress', task.style].join(' '),
                progressStl = {width: task.progress + '%'};

            var taskImg = (task.img) ? (
              <div className="media-object-section">
                <div className="thumbnail">
                  <img src={task.img} />
                </div>
              </div>
            ) : '';

            return (
              <div key={task.slug} className="small-4 column">
                <div className="media-object">
                  {taskImg}
                  <div className="media-object-section main-section">
                    <a className="alert button" href="#" onClick={this.props.handleRemoveTask.bind(null, task.slug)}><i className="fi-x"></i></a>
                    <h3>{task.url}</h3>
                    <p>{task.message}</p>
                    <p>{task.title}</p>
                    <p>{task.heading}</p>
                    <div className={progressCls}>
                      <div className="progress-meter" style={progressStl}></div>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
          </div>

          <Paginator
            {...this.props.paging}
            handlePageChange={this.props.handlePageChange} />
        </div>
    )
  }
}),
TasksForm = React.createClass({
  render: function(){
    return (
      <div className="small-12 columns">
        <form onSubmit={this.props.handleAddTask}>
          <label htmlFor="id_url">URL: </label>
          <textarea
            onChange={this.props.handleChangeUrl}
            id="id_url"
            name="id_url"
            rows="5"
            placeholder="Enter url to parse"
            defaultValue={this.props.url}></textarea>
          <button type="submit" className="success button">Add tasks</button>
        </form>
    </div>
    )
  }
});

ReactDOM.render(<TasksBox />, document.getElementById('content'));
